import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { QueryClienteDto, OrdenCliente } from './dto/query-cliente.dto';
import {
  ClienteResponseDto,
  PaginatedClienteResponseDto,
  RegistroClienteResponseDto,
} from './dto/cliente-response.dto';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { AppLoggerService } from '../common/logger';
import { CacheService } from '../redis/cache.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class ClientesService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ClientesService.name);
  }

  /**
   * Registra un nuevo cliente o asocia uno existente a la empresa
   *
   * Lógica inteligente:
   * - Si existe Persona con DNI y tiene Usuario: solo crear relaciones
   * - Si existe Persona sin Usuario: crear Usuario + relaciones
   * - Si no existe Persona: crear todo (Persona + Usuario + relaciones)
   */
  async registrarCliente(
    createDto: CreateClienteDto,
    empresaId: string,
    registradoPorId: string,
  ): Promise<RegistroClienteResponseDto> {
    const { dni, nombres, apellidos, telefono, email, notas, ...restData } =
      createDto;

    // 1. Buscar si existe una Persona con ese DNI
    const personaExistente = await this.prisma.persona.findUnique({
      where: { dni },
      include: {
        usuario: true,
        empresasAsociadas: {
          where: {
            empresaId,
            deletedAt: null,
          },
        },
      },
    });

    let yaExistia = false;
    let yaEraClienteEmpresa = false;
    let mensaje = '';
    let usuario: any;
    let persona: any;

    // CASO 1: Cliente ya existe y ya está asociado a esta empresa
    if (personaExistente && personaExistente.empresasAsociadas.length > 0) {
      yaExistia = true;
      yaEraClienteEmpresa = true;
      mensaje = 'El cliente ya está registrado en esta empresa';

      // Verificar si también tiene usuario
      if (personaExistente.usuario) {
        // Verificar relación EmpresaUsuarioRol
        const relacionUsuario =
          await this.prisma.empresaUsuarioRol.findFirst({
            where: {
              usuarioId: personaExistente.usuario.id,
              empresaId,
              rol: 'CLIENTE',
              deletedAt: null,
            },
          });

        if (!relacionUsuario) {
          // Crear relación usuario-empresa si no existe
          await this.prisma.empresaUsuarioRol.create({
            data: {
              usuarioId: personaExistente.usuario.id,
              empresaId,
              rol: 'CLIENTE',
              isActive: true,
              estado: 'ACTIVO',
              registradoPor: registradoPorId,
            },
          });
        }
      }

      persona = personaExistente;
      usuario = personaExistente.usuario;
    }
    // CASO 2: Cliente existe en sistema pero NO en esta empresa
    else if (personaExistente && personaExistente.usuario) {
      yaExistia = true;
      yaEraClienteEmpresa = false;
      mensaje = 'Cliente existente asociado exitosamente a la empresa';

      persona = personaExistente;
      usuario = personaExistente.usuario;

      // Crear relaciones con la empresa
      await this.prisma.$transaction(async (tx) => {
        // Crear EmpresaPersona
        await tx.empresaPersona.create({
          data: {
            personaId: persona.id,
            empresaId,
            rol: 'CLIENTE',
            isActive: true,
          },
        });

        // Crear EmpresaUsuarioRol
        await tx.empresaUsuarioRol.create({
          data: {
            usuarioId: usuario.id,
            empresaId,
            rol: 'CLIENTE',
            isActive: true,
            estado: 'ACTIVO',
            registradoPor: registradoPorId,
          },
        });

        // Crear RegistroCliente
        await tx.registroCliente.create({
          data: {
            usuarioId: usuario.id,
            empresaId,
            tipoRegistro: 'EMPRESA_REGISTRA',
            canalRegistro: 'PRESENCIAL',
            estado: 'AUTO_APROBADO',
            registradoPor: registradoPorId,
          },
        });
      });

      this.logger.log(
        `Cliente existente (${dni}) asociado a empresa ${empresaId} por usuario ${registradoPorId}`,
      );
    }
    // CASO 3: Existe Persona pero NO tiene Usuario (raro, pero posible)
    else if (personaExistente && !personaExistente.usuario) {
      yaExistia = true;
      yaEraClienteEmpresa = false;
      mensaje =
        'Cliente registrado exitosamente (cuenta de usuario creada)';

      persona = personaExistente;

      // Actualizar persona con nuevos datos si se proporcionan
      if (telefono || email) {
        persona = await this.prisma.persona.update({
          where: { id: persona.id },
          data: {
            telefono: telefono || persona.telefono,
            ...(email && { email }),
            ...restData,
            ...(notas && { observaciones: notas }),
            esCliente: true,
          },
        });
      }

      // Crear Usuario con contraseña temporal = DNI
      usuario = await this.crearUsuarioParaCliente(
        persona,
        dni,
        empresaId,
        registradoPorId,
      );
    }
    // CASO 4: Cliente NO existe en el sistema
    else {
      yaExistia = false;
      yaEraClienteEmpresa = false;
      mensaje = 'Cliente registrado exitosamente';

      // Crear Persona + Usuario + Relaciones
      const result = await this.crearClienteCompleto(
        createDto,
        empresaId,
        registradoPorId,
      );

      persona = result.persona;
      usuario = result.usuario;

      this.logger.log(
        `Nuevo cliente creado: ${dni} - ${nombres} ${apellidos} por usuario ${registradoPorId}`,
      );
    }

    // Invalidar caché de acceso tenant para el usuario
    if (usuario?.id) {
      await this.cache.invalidateTenantAccess(usuario.id, empresaId);
    }

    // Obtener datos completos del cliente para la respuesta
    const clienteCompleto = await this.obtenerClienteCompleto(
      persona.id,
      empresaId,
    );

    return {
      cliente: clienteCompleto,
      yaExistia,
      yaEraClienteEmpresa,
      mensaje,
    };
  }

  /**
   * Crea un cliente completamente nuevo (Persona + Usuario + Relaciones)
   */
  private async crearClienteCompleto(
    createDto: CreateClienteDto,
    empresaId: string,
    registradoPorId: string,
  ) {
    const { dni, nombres, apellidos, telefono, email, notas, ...restData } =
      createDto;

    return await this.prisma.$transaction(async (tx) => {
      // 1. Crear Persona
      const persona = await tx.persona.create({
        data: {
          dni,
          nombres,
          apellidos,
          telefono,
          email,
          ...restData,
          ...(notas && { observaciones: notas }),
          esUsuario: true,
          esCliente: true,
        },
      });

      // 2. Crear Usuario con contraseña temporal = DNI
      const passwordHash = await bcrypt.hash(dni, 12);
      const usuario = await tx.usuario.create({
        data: {
          personaId: persona.id,
          email: email || null,
          telefono: telefono,
          passwordHash,
          emailVerificado: email ? false : true, // Si no tiene email, marcar como verificado
          telefonoVerificado: false,
          authMethodsCount: 1,
          metodoPrincipalLogin: email ? 'EMAIL' : 'DNI',
          requiereCambioPassword: true, // Debe cambiar contraseña en primer acceso
          dniVerificado: false,
          rolGlobal: 'CLIENTE',
        },
      });

      // 3. Crear AuthProvider
      await tx.authProvider.create({
        data: {
          userId: usuario.id,
          provider: 'PASSWORD',
          providerId: usuario.id,
          email: email || dni,
          isActive: true,
        },
      });

      // 4. Crear EmpresaPersona
      await tx.empresaPersona.create({
        data: {
          personaId: persona.id,
          empresaId,
          rol: 'CLIENTE',
          isActive: true,
        },
      });

      // 5. Crear EmpresaUsuarioRol
      await tx.empresaUsuarioRol.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          rol: 'CLIENTE',
          isActive: true,
          estado: 'ACTIVO',
          registradoPor: registradoPorId,
        },
      });

      // 6. Crear RegistroCliente (auditoría)
      await tx.registroCliente.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          tipoRegistro: 'EMPRESA_REGISTRA',
          canalRegistro: 'PRESENCIAL',
          estado: 'AUTO_APROBADO',
          registradoPor: registradoPorId,
        },
      });

      return { persona, usuario };
    });
  }

  /**
   * Crea un usuario para una persona existente
   */
  private async crearUsuarioParaCliente(
    persona: any,
    dni: string,
    empresaId: string,
    registradoPorId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const passwordHash = await bcrypt.hash(dni, 12);

      const usuario = await tx.usuario.create({
        data: {
          personaId: persona.id,
          email: persona.email || null,
          telefono: persona.telefono,
          passwordHash,
          emailVerificado: persona.email ? false : true,
          telefonoVerificado: false,
          authMethodsCount: 1,
          metodoPrincipalLogin: persona.email ? 'EMAIL' : 'DNI',
          requiereCambioPassword: true,
          dniVerificado: false,
          rolGlobal: 'CLIENTE',
        },
      });

      await tx.authProvider.create({
        data: {
          userId: usuario.id,
          provider: 'PASSWORD',
          providerId: usuario.id,
          email: persona.email || dni,
          isActive: true,
        },
      });

      await tx.empresaPersona.create({
        data: {
          personaId: persona.id,
          empresaId,
          rol: 'CLIENTE',
          isActive: true,
        },
      });

      await tx.empresaUsuarioRol.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          rol: 'CLIENTE',
          isActive: true,
          estado: 'ACTIVO',
          registradoPor: registradoPorId,
        },
      });

      await tx.registroCliente.create({
        data: {
          usuarioId: usuario.id,
          empresaId,
          tipoRegistro: 'EMPRESA_REGISTRA',
          canalRegistro: 'PRESENCIAL',
          estado: 'AUTO_APROBADO',
          registradoPor: registradoPorId,
        },
      });

      return usuario;
    });
  }

  /**
   * Obtiene la lista de clientes de una empresa con filtros y paginación
   * OPTIMIZADO: Usa includes para evitar N+1 queries
   */
  async findAll(
    empresaId: string,
    queryDto: QueryClienteDto,
  ): Promise<PaginatedClienteResponseDto> {
    const { page = 1, limit = 10, search, isActive, orden } = queryDto;
    const skip = (page - 1) * limit;

    // Construir filtros
    const where: any = {
      empresaId,
      deletedAt: null,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.persona = {
        OR: [
          { nombres: { contains: search, mode: 'insensitive' } },
          { apellidos: { contains: search, mode: 'insensitive' } },
          { dni: { contains: search, mode: 'insensitive' } },
          { telefono: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // Determinar ordenamiento
    let orderBy: any = { creadoEn: 'desc' }; // Por defecto: más recientes
    if (orden) {
      switch (orden) {
        case OrdenCliente.NOMBRE_ASC:
          orderBy = { persona: { nombres: 'asc' } };
          break;
        case OrdenCliente.NOMBRE_DESC:
          orderBy = { persona: { nombres: 'desc' } };
          break;
        case OrdenCliente.RECIENTES:
          orderBy = { creadoEn: 'desc' };
          break;
        case OrdenCliente.ANTIGUOS:
          orderBy = { creadoEn: 'asc' };
          break;
      }
    }

    // Obtener datos y count en paralelo
    // Para búsquedas, usamos count limitado para evitar escanear millones de filas
    const MAX_COUNT_SCAN = 10000;

    const countQuery = search
      ? this.prisma.empresaPersona.findMany({
          where,
          select: { id: true },
          take: MAX_COUNT_SCAN,
        }).then(rows => rows.length)
      : this.prisma.empresaPersona.count({ where });

    const [clientes, total] = await Promise.all([
      this.prisma.empresaPersona.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          persona: {
            include: {
              usuario: {
                select: {
                  id: true,
                  email: true,
                  telefono: true,
                  emailVerificado: true,
                  telefonoVerificado: true,
                  dniVerificado: true,
                  isActive: true,
                  // Incluir registros de cliente para evitar query extra
                  registrosComoCliente: {
                    where: { empresaId },
                    orderBy: { creadoEn: 'asc' },
                    take: 1,
                  },
                  // Incluir relación empresa-usuario-rol para evitar query extra
                  empresas: {
                    where: {
                      empresaId,
                      rol: 'CLIENTE',
                      deletedAt: null,
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      }),
      countQuery,
    ]);

    // Obtener todos los IDs de registradores únicos para una sola query
    const registradorIds = new Set<string>();
    clientes.forEach((c) => {
      const registro = c.persona.usuario?.registrosComoCliente?.[0];
      if (registro?.registradoPor) {
        registradorIds.add(registro.registradoPor);
      }
    });

    // Query única para obtener todos los registradores
    const registradores =
      registradorIds.size > 0
        ? await this.prisma.usuario.findMany({
            where: { id: { in: Array.from(registradorIds) } },
            include: {
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          })
        : [];

    // Crear mapa de registradores para acceso O(1)
    const registradoresMap = new Map(
      registradores.map((r) => [r.id, r]),
    );

    // Transformar datos sin queries adicionales
    const data = clientes.map((c) =>
      this.toResponseDto(c, empresaId, registradoresMap),
    );

    return createPaginatedResponse(data, total, page, limit);
  }

  /**
   * Obtiene un cliente específico por ID
   * OPTIMIZADO: Incluye todas las relaciones para evitar N+1 queries
   */
  async findOne(
    clienteId: string,
    empresaId: string,
  ): Promise<ClienteResponseDto> {
    const cliente = await this.prisma.empresaPersona.findFirst({
      where: {
        id: clienteId,
        empresaId,
        deletedAt: null,
      },
      include: {
        persona: {
          include: {
            usuario: {
              select: {
                id: true,
                email: true,
                telefono: true,
                emailVerificado: true,
                telefonoVerificado: true,
                dniVerificado: true,
                isActive: true,
                // Incluir registros de cliente
                registrosComoCliente: {
                  where: { empresaId },
                  orderBy: { creadoEn: 'asc' },
                  take: 1,
                },
                // Incluir relación empresa-usuario-rol
                empresas: {
                  where: {
                    empresaId,
                    rol: 'CLIENTE',
                    deletedAt: null,
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!cliente) {
      throw new NotFoundException(
        `Cliente con ID ${clienteId} no encontrado en esta empresa`,
      );
    }

    // Obtener registrador si existe
    const registroInfo = cliente.persona.usuario?.registrosComoCliente?.[0];
    let registradoresMap: Map<string, any> | undefined = undefined;

    if (registroInfo?.registradoPor) {
      const registrador = await this.prisma.usuario.findUnique({
        where: { id: registroInfo.registradoPor },
        include: {
          persona: {
            select: {
              nombres: true,
              apellidos: true,
            },
          },
        },
      });

      if (registrador) {
        registradoresMap = new Map([[registrador.id, registrador]]);
      }
    }

    return this.toResponseDto(cliente, empresaId, registradoresMap);
  }

  /**
   * Actualiza un cliente
   */
  async update(
    clienteId: string,
    empresaId: string,
    updateDto: UpdateClienteDto,
  ): Promise<ClienteResponseDto> {
    // Verificar que el cliente existe en la empresa
    const clienteExistente = await this.prisma.empresaPersona.findFirst({
      where: {
        id: clienteId,
        empresaId,
        deletedAt: null,
      },
      include: { persona: true },
    });

    if (!clienteExistente) {
      throw new NotFoundException('Cliente no encontrado en esta empresa');
    }

    const { isActive, notas, ...personaData } = updateDto;

    await this.prisma.$transaction(async (tx) => {
      // Actualizar datos de la persona (si se proporcionan)
      const dataToUpdate = {
        ...personaData,
        ...(notas !== undefined && { observaciones: notas }),
      };
      if (Object.keys(dataToUpdate).length > 0) {
        await tx.persona.update({
          where: { id: clienteExistente.personaId },
          data: dataToUpdate,
        });
      }

      // Actualizar estado en la relación empresa-persona (si se proporciona)
      if (isActive !== undefined) {
        await tx.empresaPersona.update({
          where: { id: clienteId },
          data: { isActive },
        });
      }
    });

    this.logger.log(
      `Cliente ${clienteId} actualizado en empresa ${empresaId}`,
    );

    return this.findOne(clienteId, empresaId);
  }

  /**
   * Elimina (soft delete) un cliente de la empresa
   */
  async remove(
    clienteId: string,
    empresaId: string,
  ): Promise<{ message: string }> {
    const cliente = await this.prisma.empresaPersona.findFirst({
      where: {
        id: clienteId,
        empresaId,
        deletedAt: null,
      },
      include: {
        persona: {
          select: { usuario: { select: { id: true } } },
        },
      },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado en esta empresa');
    }

    await this.prisma.empresaPersona.update({
      where: { id: clienteId },
      data: { deletedAt: new Date() },
    });

    // Invalidar caché de acceso tenant
    const usuarioId = cliente.persona?.usuario?.id;
    if (usuarioId) {
      await this.cache.invalidateTenantAccess(usuarioId, empresaId);
    }

    this.logger.log(
      `Cliente ${clienteId} eliminado (soft delete) de empresa ${empresaId}`,
    );

    return { message: 'Cliente eliminado exitosamente' };
  }

  /**
   * Obtiene datos completos de un cliente para la respuesta
   * OPTIMIZADO: Incluye todas las relaciones para evitar N+1 queries
   */
  private async obtenerClienteCompleto(
    personaId: string,
    empresaId: string,
  ): Promise<ClienteResponseDto> {
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: {
        personaId,
        empresaId,
        deletedAt: null,
      },
      include: {
        persona: {
          include: {
            usuario: {
              select: {
                id: true,
                email: true,
                telefono: true,
                emailVerificado: true,
                telefonoVerificado: true,
                dniVerificado: true,
                isActive: true,
                // Incluir registros de cliente
                registrosComoCliente: {
                  where: { empresaId },
                  orderBy: { creadoEn: 'asc' },
                  take: 1,
                },
                // Incluir relación empresa-usuario-rol
                empresas: {
                  where: {
                    empresaId,
                    rol: 'CLIENTE',
                    deletedAt: null,
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!empresaPersona) {
      throw new NotFoundException('Cliente no encontrado');
    }

    // Obtener registrador si existe
    const registroInfo = empresaPersona.persona.usuario?.registrosComoCliente?.[0];
    let registradoresMap: Map<string, any> | undefined = undefined;

    if (registroInfo?.registradoPor) {
      const registrador = await this.prisma.usuario.findUnique({
        where: { id: registroInfo.registradoPor },
        include: {
          persona: {
            select: {
              nombres: true,
              apellidos: true,
            },
          },
        },
      });

      if (registrador) {
        registradoresMap = new Map([[registrador.id, registrador]]);
      }
    }

    return this.toResponseDto(empresaPersona, empresaId, registradoresMap);
  }

  /**
   * Convierte entidad a DTO de respuesta
   * OPTIMIZADO: Usa datos precargados para evitar queries adicionales
   *
   * @param empresaPersona - Entidad con datos precargados via includes
   * @param empresaId - ID de la empresa
   * @param registradoresMap - Mapa opcional de registradores precargados (para evitar N+1)
   */
  private toResponseDto(
    empresaPersona: any,
    empresaId: string,
    registradoresMap?: Map<string, any>,
  ): ClienteResponseDto {
    const persona = empresaPersona.persona;
    const usuario = persona.usuario;

    // Usar información del registro precargada (si está disponible)
    const registroInfo = usuario?.registrosComoCliente?.[0] || null;

    // Obtener nombre del registrador desde el mapa (si está disponible)
    let registradorNombre: string | undefined = undefined;
    if (registroInfo?.registradoPor && registradoresMap) {
      const registrador = registradoresMap.get(registroInfo.registradoPor);
      if (registrador?.persona) {
        registradorNombre = `${registrador.persona.nombres} ${registrador.persona.apellidos}`;
      }
    }

    // Usar estado de la relación usuario-empresa precargada (si está disponible)
    const empresaUsuarioRol = usuario?.empresas?.[0];
    const estadoCliente = empresaUsuarioRol?.estado || 'ACTIVO';

    return {
      id: empresaPersona.id,
      personaId: persona.id,
      usuarioId: usuario?.id,
      dni: persona.dni,
      nombres: persona.nombres,
      apellidos: persona.apellidos,
      nombreCompleto: `${persona.nombres} ${persona.apellidos}`,
      telefono: persona.telefono,
      email: persona.email || usuario?.email,
      direccion: persona.direccion,
      distrito: persona.distrito,
      provincia: persona.provincia,
      departamento: persona.departamento,
      isActive: empresaPersona.isActive,
      estado: estadoCliente,
      emailVerificado: usuario?.emailVerificado,
      telefonoVerificado: usuario?.telefonoVerificado,
      dniVerificado: usuario?.dniVerificado,
      yaExistiaEnSistema: registroInfo?.tipoRegistro !== 'EMPRESA_CREA',
      registradoPor: registroInfo?.registradoPor,
      registradoPorNombre: registradorNombre,
      fechaRegistro: registroInfo?.creadoEn || empresaPersona.creadoEn,
      creadoEn: empresaPersona.creadoEn,
      actualizadoEn: empresaPersona.actualizadoEn,
    };
  }
}
