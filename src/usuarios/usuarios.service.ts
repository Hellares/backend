import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUsuarioDto } from './dto';
import {
  RegistroUsuarioResponseDto,
  UsuarioResponseDto,
} from './dto/usuario-response.dto';
import { AppLoggerService } from '../common/logger';
import { generatePaginationMeta } from '../common/utils/pagination.util';
import * as bcrypt from 'bcryptjs';
import { Rol, SedeRole } from '@prisma/client';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { CacheService } from '../redis/cache.service';

@Injectable()
export class UsuariosService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private planLimitsService: PlanLimitsService,
    private cache: CacheService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(UsuariosService.name);
  }

  /**
   * Método principal para registrar un usuario/trabajador en una empresa
   * Maneja 4 casos diferentes según el estado de la persona y usuario
   */
  async registrarUsuario(
    empresaId: string,
    createUsuarioDto: CreateUsuarioDto,
    registradoPor?: string,
  ): Promise<RegistroUsuarioResponseDto> {
    const { dni, nombres, apellidos, email, telefono, rol, sedeIds } =
      createUsuarioDto;

    // Validar que el rol NO sea CLIENTE (solo trabajadores)
    if (rol === Rol.CLIENTE) {
      throw new BadRequestException(
        'No se puede registrar un usuario con rol CLIENTE. Use el módulo de clientes',
      );
    }

    // Validar que las sedes pertenezcan a la empresa
    if (sedeIds && sedeIds.length > 0) {
      await this.validarSedesEmpresa(sedeIds, empresaId);
    }

    // Buscar si existe una persona con este DNI
    const personaExistente = await this.prisma.persona.findUnique({
      where: { dni },
      include: {
        usuario: {
          include: {
            empresas: {
              where: { empresaId },
            },
          },
        },
      },
    });

    // Validar unicidad de email/teléfono solo si NO existe un usuario previo
    // (CASO 1 y 2: el email/teléfono ya pertenecen al mismo usuario)
    if (!personaExistente?.usuario) {
      await this.validarEmailTelefonoUnicos(email, telefono);
    }

    // Verificar límite de usuarios del plan de suscripción
    // (solo si no es una promoción de cliente existente en la empresa)
    const esPromocionCliente =
      personaExistente?.usuario &&
      personaExistente.usuario.empresas.length > 0 &&
      personaExistente.usuario.empresas[0].rol === Rol.CLIENTE;

    if (!esPromocionCliente) {
      await this.planLimitsService.checkUsuariosLimit(empresaId);
    }

    let yaExistia = false;
    let yaEraEmpleadoEmpresa = false;
    let mensaje = '';
    let usuario: any;

    // CASO 1: Usuario ya existe en esta empresa
    if (
      personaExistente?.usuario &&
      personaExistente.usuario.empresas.length > 0
    ) {
      const empresaRol = personaExistente.usuario.empresas[0];

      // Si es CLIENTE, permitir promoción a empleado (actualizar rol)
      if (empresaRol.rol === Rol.CLIENTE) {
        yaExistia = true;
        yaEraEmpleadoEmpresa = false;
        mensaje = 'Cliente promovido a empleado exitosamente';

        // Actualizar el rol de CLIENTE al nuevo rol
        await this.prisma.empresaUsuarioRol.update({
          where: { id: empresaRol.id },
          data: {
            rol,
            registradoPor,
          },
        });

        // Asignar sedes si se proporcionaron
        if (sedeIds && sedeIds.length > 0) {
          const sedeRole = this.mapRolToSedeRole(rol);

          await this.prisma.usuarioSedeRol.createMany({
            data: sedeIds.map((sedeId) => ({
              usuarioId: personaExistente.usuario!.id,
              sedeId,
              rol: sedeRole,
              puedeAbrirCaja: createUsuarioDto.puedeAbrirCaja ?? false,
              puedeCerrarCaja: createUsuarioDto.puedeCerrarCaja ?? false,
              limiteCreditoVenta: createUsuarioDto.limiteCreditoVenta,
              permisos: createUsuarioDto.permisos ?? [],
              accesosRapidosOcultos: createUsuarioDto.accesosRapidosOcultos ?? [],
              creadoPor: registradoPor,
            })),
          });
        }

        usuario = { id: personaExistente.usuario!.id };

        this.logger.log(
          `Cliente (${dni}) promovido a empleado con rol ${rol} en empresa ${empresaId} por usuario ${registradoPor}`,
        );
      } else {
        // Ya es empleado — conflicto real
        throw new ConflictException(
          'El usuario ya está registrado en esta empresa',
        );
      }
    }

    // CASO 2: Usuario existe pero no en esta empresa (asignar)
    if (
      personaExistente?.usuario &&
      personaExistente.usuario.empresas.length === 0
    ) {
      yaExistia = true;
      yaEraEmpleadoEmpresa = false;
      mensaje = 'Usuario existente asignado exitosamente a la empresa';

      usuario = await this.asignarUsuarioExistenteAEmpresa(
        personaExistente.usuario.id,
        personaExistente.id,
        empresaId,
        rol,
        sedeIds,
        createUsuarioDto,
        registradoPor,
      );

      this.logger.log(
        `Usuario existente (${dni}) asignado a empresa ${empresaId} con rol ${rol} por usuario ${registradoPor}`,
      );
    }
    // CASO 3: Persona existe sin usuario (crear usuario)
    else if (personaExistente && !personaExistente.usuario) {
      yaExistia = true;
      yaEraEmpleadoEmpresa = false;
      mensaje = 'Usuario registrado exitosamente (cuenta de usuario creada)';

      usuario = await this.crearUsuarioParaPersonaExistente(
        personaExistente.id,
        dni,
        email,
        telefono,
        empresaId,
        rol,
        sedeIds,
        createUsuarioDto,
        registradoPor,
      );

      this.logger.log(
        `Usuario creado para persona existente (${dni}) en empresa ${empresaId} con rol ${rol}`,
      );
    }
    // CASO 4: Crear todo desde cero (persona + usuario + relaciones)
    else {
      yaExistia = false;
      yaEraEmpleadoEmpresa = false;
      mensaje = 'Usuario registrado exitosamente';

      usuario = await this.crearUsuarioCompleto(
        {
          dni, nombres, apellidos, email, telefono,
          direccion: createUsuarioDto.direccion,
          distrito: createUsuarioDto.distrito,
          provincia: createUsuarioDto.provincia,
          departamento: createUsuarioDto.departamento,
        },
        empresaId,
        rol,
        sedeIds,
        createUsuarioDto,
        registradoPor,
      );

      this.logger.log(
        `Nuevo usuario creado: ${dni} - ${nombres} ${apellidos} con rol ${rol} por usuario ${registradoPor}`,
      );
    }

    // Invalidar caché de acceso tenant
    await this.cache.invalidateTenantAccess(usuario.id, empresaId);

    // Obtener datos completos del usuario para la respuesta
    const usuarioCompleto = await this.obtenerUsuarioCompleto(
      usuario.id,
      empresaId,
    );

    return {
      usuario: usuarioCompleto,
      yaExistia,
      yaEraEmpleadoEmpresa,
      mensaje,
    };
  }

  /**
   * Valida que email y teléfono sean únicos
   */
  private async validarEmailTelefonoUnicos(
    email?: string,
    telefono?: string,
  ): Promise<void> {
    if (email) {
      const usuarioConEmail = await this.prisma.usuario.findUnique({
        where: { email },
      });
      if (usuarioConEmail) {
        throw new ConflictException(
          'Ya existe un usuario registrado con ese email',
        );
      }
    }

    if (telefono) {
      const usuarioConTelefono = await this.prisma.usuario.findUnique({
        where: { telefono },
      });
      if (usuarioConTelefono) {
        throw new ConflictException(
          'Ya existe un usuario registrado con ese teléfono',
        );
      }
    }
  }

  /**
   * Valida que todas las sedes pertenezcan a la empresa
   */
  private async validarSedesEmpresa(
    sedeIds: string[],
    empresaId: string,
  ): Promise<void> {
    const sedesValidas = await this.prisma.sede.findMany({
      where: {
        id: { in: sedeIds },
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (sedesValidas.length !== sedeIds.length) {
      throw new BadRequestException(
        'Una o más sedes no pertenecen a esta empresa o están inactivas',
      );
    }
  }

  /**
   * CASO 2: Asignar un usuario existente a una nueva empresa
   */
  private async asignarUsuarioExistenteAEmpresa(
    usuarioId: string,
    personaId: string,
    empresaId: string,
    rol: Rol,
    sedeIds: string[] | undefined,
    createUsuarioDto: CreateUsuarioDto,
    registradoPor?: string,
  ) {
    return this.prisma.$transaction(async (prisma) => {
      // Crear EmpresaPersona (relación persona-empresa como empleado)
      await prisma.empresaPersona.create({
        data: {
          personaId,
          empresaId,
          rol: 'EMPLEADO',
          isActive: true,
        },
      });

      // Crear relación EmpresaUsuarioRol
      await prisma.empresaUsuarioRol.create({
        data: {
          empresaId,
          usuarioId,
          rol,
          registradoPor,
          estado: 'ACTIVO',
        },
      });

      // Si hay sedeIds, crear UsuarioSedeRol para cada sede
      if (sedeIds && sedeIds.length > 0) {
        const sedeRole = this.mapRolToSedeRole(rol);

        await prisma.usuarioSedeRol.createMany({
          data: sedeIds.map((sedeId) => ({
            usuarioId,
            sedeId,
            rol: sedeRole,
            puedeAbrirCaja: createUsuarioDto.puedeAbrirCaja ?? false,
            puedeCerrarCaja: createUsuarioDto.puedeCerrarCaja ?? false,
            limiteCreditoVenta: createUsuarioDto.limiteCreditoVenta,
            permisos: createUsuarioDto.permisos ?? [],
            accesosRapidosOcultos: createUsuarioDto.accesosRapidosOcultos ?? [],
            creadoPor: registradoPor,
          })),
        });
      }

      // Retornar solo el id (obtenerUsuarioCompleto trae datos completos)
      return { id: usuarioId };
    });
  }

  /**
   * CASO 3: Crear usuario para una persona existente
   */
  private async crearUsuarioParaPersonaExistente(
    personaId: string,
    dni: string,
    email: string | undefined,
    telefono: string | undefined,
    empresaId: string,
    rol: Rol,
    sedeIds: string[] | undefined,
    createUsuarioDto: CreateUsuarioDto,
    registradoPor?: string,
  ) {
    // Password temporal = DNI
    const passwordHash = await bcrypt.hash(dni, 12);

    return this.prisma.$transaction(async (prisma) => {
      // Actualizar persona para marcarla como usuario
      await prisma.persona.update({
        where: { id: personaId },
        data: {
          esUsuario: true,
          email: email,
          telefono: telefono,
        },
      });

      // Crear usuario con todos los campos
      const usuario = await prisma.usuario.create({
        data: {
          personaId,
          email: email || null,
          telefono: telefono || null,
          passwordHash,
          requiereCambioPassword: true,
          authMethodsCount: 1,
          metodoPrincipalLogin: email ? 'EMAIL' : 'DNI',
          rolGlobal: rol,
          emailVerificado: email ? false : true,
          telefonoVerificado: false,
          dniVerificado: false,
        },
      });

      // Crear AuthProvider
      await prisma.authProvider.create({
        data: {
          userId: usuario.id,
          provider: 'PASSWORD',
          providerId: usuario.id,
          email: email || dni,
          isActive: true,
        },
      });

      // Crear EmpresaPersona
      await prisma.empresaPersona.create({
        data: {
          personaId,
          empresaId,
          rol: 'EMPLEADO',
          isActive: true,
        },
      });

      // Crear relación EmpresaUsuarioRol
      await prisma.empresaUsuarioRol.create({
        data: {
          empresaId,
          usuarioId: usuario.id,
          rol,
          registradoPor,
          estado: 'ACTIVO',
        },
      });

      // Si hay sedeIds, crear UsuarioSedeRol para cada sede
      if (sedeIds && sedeIds.length > 0) {
        const sedeRole = this.mapRolToSedeRole(rol);

        await prisma.usuarioSedeRol.createMany({
          data: sedeIds.map((sedeId) => ({
            usuarioId: usuario.id,
            sedeId,
            rol: sedeRole,
            puedeAbrirCaja: createUsuarioDto.puedeAbrirCaja ?? false,
            puedeCerrarCaja: createUsuarioDto.puedeCerrarCaja ?? false,
            limiteCreditoVenta: createUsuarioDto.limiteCreditoVenta,
            permisos: createUsuarioDto.permisos ?? [],
            accesosRapidosOcultos: createUsuarioDto.accesosRapidosOcultos ?? [],
            creadoPor: registradoPor,
          })),
        });
      }

      return usuario;
    });
  }

  /**
   * CASO 4: Crear todo desde cero (persona + usuario + relaciones)
   */
  private async crearUsuarioCompleto(
    personaData: {
      dni: string;
      nombres: string;
      apellidos: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      distrito?: string;
      provincia?: string;
      departamento?: string;
    },
    empresaId: string,
    rol: Rol,
    sedeIds: string[] | undefined,
    createUsuarioDto: CreateUsuarioDto,
    registradoPor?: string,
  ) {
    // Password temporal = DNI
    const passwordHash = await bcrypt.hash(personaData.dni, 12);

    return this.prisma.$transaction(async (prisma) => {
      // Crear persona
      const persona = await prisma.persona.create({
        data: {
          dni: personaData.dni,
          nombres: personaData.nombres,
          apellidos: personaData.apellidos,
          email: personaData.email,
          telefono: personaData.telefono,
          direccion: personaData.direccion,
          distrito: personaData.distrito,
          provincia: personaData.provincia,
          departamento: personaData.departamento,
          esUsuario: true,
        },
      });

      // Crear usuario con todos los campos
      const usuario = await prisma.usuario.create({
        data: {
          personaId: persona.id,
          email: personaData.email || null,
          telefono: personaData.telefono || null,
          passwordHash,
          requiereCambioPassword: true,
          authMethodsCount: 1,
          metodoPrincipalLogin: personaData.email ? 'EMAIL' : 'DNI',
          rolGlobal: rol,
          emailVerificado: personaData.email ? false : true,
          telefonoVerificado: false,
          dniVerificado: false,
        },
      });

      // Crear AuthProvider
      await prisma.authProvider.create({
        data: {
          userId: usuario.id,
          provider: 'PASSWORD',
          providerId: usuario.id,
          email: personaData.email || personaData.dni,
          isActive: true,
        },
      });

      // Crear EmpresaPersona
      await prisma.empresaPersona.create({
        data: {
          personaId: persona.id,
          empresaId,
          rol: 'EMPLEADO',
          isActive: true,
        },
      });

      // Crear relación EmpresaUsuarioRol
      await prisma.empresaUsuarioRol.create({
        data: {
          empresaId,
          usuarioId: usuario.id,
          rol,
          registradoPor,
          estado: 'ACTIVO',
        },
      });

      // Si hay sedeIds, crear UsuarioSedeRol para cada sede
      if (sedeIds && sedeIds.length > 0) {
        const sedeRole = this.mapRolToSedeRole(rol);

        await prisma.usuarioSedeRol.createMany({
          data: sedeIds.map((sedeId) => ({
            usuarioId: usuario.id,
            sedeId,
            rol: sedeRole,
            puedeAbrirCaja: createUsuarioDto.puedeAbrirCaja ?? false,
            puedeCerrarCaja: createUsuarioDto.puedeCerrarCaja ?? false,
            limiteCreditoVenta: createUsuarioDto.limiteCreditoVenta,
            permisos: createUsuarioDto.permisos ?? [],
            accesosRapidosOcultos: createUsuarioDto.accesosRapidosOcultos ?? [],
            creadoPor: registradoPor,
          })),
        });
      }

      return usuario;
    });
  }

  /**
   * Helper para mapear Rol a SedeRole
   */
  private mapRolToSedeRole(rol: Rol): SedeRole {
    const roleMap: Record<Rol, SedeRole> = {
      [Rol.SUPER_ADMIN]: SedeRole.ADMINISTRADOR,
      [Rol.EMPRESA_ADMIN]: SedeRole.ADMINISTRADOR,
      [Rol.SEDE_ADMIN]: SedeRole.GERENTE_SEDE,
      [Rol.CAJERO]: SedeRole.CAJERO,
      [Rol.VENDEDOR]: SedeRole.VENDEDOR,
      [Rol.TECNICO]: SedeRole.TECNICO_SERVICIO,
      [Rol.CONTADOR]: SedeRole.CONTADOR_SEDE,
      [Rol.LECTURA]: SedeRole.CONSULTOR,
      [Rol.OPERADOR]: SedeRole.ASISTENTE,
      [Rol.CLIENTE]: SedeRole.CAJERO, // No debería llegar aquí
    };

    return roleMap[rol] || SedeRole.ASISTENTE;
  }

  /**
   * Obtiene datos completos de un usuario para la respuesta
   */
  private async obtenerUsuarioCompleto(
    usuarioId: string,
    empresaId: string,
  ): Promise<UsuarioResponseDto> {
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId,
        empresaId,
        deletedAt: null,
      },
      include: {
        usuario: {
          include: {
            persona: true,
            sedes: {
              where: { isActive: true, deletedAt: null },
              include: {
                sede: {
                  select: {
                    id: true,
                    nombre: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!empresaUsuario) {
      throw new NotFoundException('Usuario no encontrado en esta empresa');
    }

    const usuario = empresaUsuario.usuario;
    const persona = usuario.persona;

    // Obtener nombre del registrador
    let registradorNombre: string | undefined = undefined;
    if (empresaUsuario.registradoPor) {
      const registrador = await this.prisma.usuario.findUnique({
        where: { id: empresaUsuario.registradoPor },
        include: {
          persona: {
            select: {
              nombres: true,
              apellidos: true,
            },
          },
        },
      });
      if (registrador?.persona) {
        registradorNombre = `${registrador.persona.nombres} ${registrador.persona.apellidos}`;
      }
    }

    return {
      id: usuario.id,
      personaId: persona.id,
      dni: persona.dni!,
      nombres: persona.nombres,
      apellidos: persona.apellidos,
      nombreCompleto: `${persona.nombres} ${persona.apellidos}`,
      email: persona.email || usuario.email || undefined,
      telefono: persona.telefono || usuario.telefono || undefined,
      direccion: persona.direccion || undefined,
      distrito: persona.distrito || undefined,
      provincia: persona.provincia || undefined,
      departamento: persona.departamento || undefined,
      rolEnEmpresa: empresaUsuario.rol,
      rolGlobal: usuario.rolGlobal || undefined,
      isActive: usuario.isActive,
      emailVerificado: usuario.emailVerificado,
      telefonoVerificado: usuario.telefonoVerificado,
      dniVerificado: usuario.dniVerificado,
      requiereCambioPassword: usuario.requiereCambioPassword,
      lastLoginAt: usuario.lastLoginAt || undefined,
      estado: empresaUsuario.estado,
      registradoPor: empresaUsuario.registradoPor || undefined,
      registradoPorNombre: registradorNombre,
      creadoEn: empresaUsuario.creadoEn,
      actualizadoEn: empresaUsuario.actualizadoEn,
      sedes: usuario.sedes.map((us) => ({
        id: us.id,
        sedeId: us.sedeId,
        sedeNombre: us.sede.nombre,
        rol: us.rol,
        puedeAbrirCaja: us.puedeAbrirCaja,
        puedeCerrarCaja: us.puedeCerrarCaja,
        limiteCreditoVenta: us.limiteCreditoVenta
          ? parseFloat(us.limiteCreditoVenta.toString())
          : undefined,
        permisos: us.permisos,
        accesosRapidosOcultos: us.accesosRapidosOcultos,
        isActive: us.isActive,
      })),
    };
  }

  /**
   * Obtener todos los usuarios de una empresa con paginación y filtros
   */
  async obtenerUsuarios(empresaId: string, queryDto: any) {
    const { page = 1, limit = 10, search, isActive, rol, sedeId, orden } = queryDto;

    const skip = (page - 1) * limit;

    // Construir condiciones WHERE
    const where: any = {
      empresaId,
      deletedAt: null,
      // Excluir clientes — solo mostrar staff/empleados
      rol: { not: Rol.CLIENTE },
    };

    // Filtro por rol
    if (rol) {
      where.rol = rol;
    }

    // Filtro por estado
    if (isActive !== undefined) {
      where.usuario = {
        ...where.usuario,
        isActive,
      };
    }

    // Filtro por búsqueda (nombre, dni, telefono, email)
    if (search) {
      where.usuario = {
        ...where.usuario,
        persona: {
          OR: [
            { nombres: { contains: search, mode: 'insensitive' } },
            { apellidos: { contains: search, mode: 'insensitive' } },
            { dni: { contains: search } },
            { telefono: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    // Filtro por sede
    if (sedeId) {
      where.usuario = {
        ...where.usuario,
        sedes: {
          some: {
            sedeId,
            isActive: true,
            deletedAt: null,
          },
        },
      };
    }

    // Definir ordenamiento
    let orderBy: any = {};
    switch (orden) {
      case 'nombre_asc':
        orderBy = { usuario: { persona: { nombres: 'asc' } } };
        break;
      case 'nombre_desc':
        orderBy = { usuario: { persona: { nombres: 'desc' } } };
        break;
      case 'recientes':
        orderBy = { creadoEn: 'desc' };
        break;
      case 'antiguos':
        orderBy = { creadoEn: 'asc' };
        break;
      default:
        orderBy = { creadoEn: 'desc' };
    }

    // Ejecutar consultas en paralelo
    const [empresaUsuarios, total] = await Promise.all([
      this.prisma.empresaUsuarioRol.findMany({
        where,
        include: {
          usuario: {
            include: {
              persona: true,
              sedes: {
                where: { isActive: true, deletedAt: null },
                include: {
                  sede: {
                    select: {
                      id: true,
                      nombre: true,
                    },
                  },
                },
              },
            },
          },
          registrador: {
            select: {
              id: true,
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.empresaUsuarioRol.count({ where }),
    ]);

    // Mapear resultados
    const data = empresaUsuarios.map((eu) => {
      const usuario = eu.usuario;
      const persona = usuario.persona;

      // Obtener nombre del registrador
      let registradoPorNombre: string | undefined = undefined;
      if (eu.registrador?.persona) {
        registradoPorNombre = `${eu.registrador.persona.nombres} ${eu.registrador.persona.apellidos}`;
      }

      return {
        id: usuario.id,
        personaId: persona.id,
        dni: persona.dni!,
        nombres: persona.nombres,
        apellidos: persona.apellidos,
        nombreCompleto: `${persona.nombres} ${persona.apellidos}`,
        email: persona.email || usuario.email || undefined,
        telefono: persona.telefono || usuario.telefono || undefined,
        direccion: persona.direccion || undefined,
        distrito: persona.distrito || undefined,
        provincia: persona.provincia || undefined,
        departamento: persona.departamento || undefined,
        rolEnEmpresa: eu.rol,
        rolGlobal: usuario.rolGlobal || undefined,
        isActive: usuario.isActive,
        emailVerificado: usuario.emailVerificado,
        telefonoVerificado: usuario.telefonoVerificado,
        dniVerificado: usuario.dniVerificado,
        requiereCambioPassword: usuario.requiereCambioPassword,
        lastLoginAt: usuario.lastLoginAt || undefined,
        estado: eu.estado,
        registradoPor: eu.registradoPor || undefined,
        registradoPorNombre,
        creadoEn: eu.creadoEn,
        actualizadoEn: eu.actualizadoEn,
        sedes: usuario.sedes.map((us) => ({
          id: us.id,
          sedeId: us.sedeId,
          sedeNombre: us.sede.nombre,
          rol: us.rol,
          puedeAbrirCaja: us.puedeAbrirCaja,
          puedeCerrarCaja: us.puedeCerrarCaja,
          limiteCreditoVenta: us.limiteCreditoVenta
            ? parseFloat(us.limiteCreditoVenta.toString())
            : undefined,
          permisos: us.permisos,
          accesosRapidosOcultos: us.accesosRapidosOcultos,
          isActive: us.isActive,
        })),
      };
    });

    // Construir respuesta paginada usando la utilidad
    return {
      data,
      meta: generatePaginationMeta(total, page, limit),
    };
  }

  /**
   * Obtener un usuario específico de una empresa
   */
  async obtenerUsuario(empresaId: string, usuarioId: string) {
    return this.obtenerUsuarioCompleto(usuarioId, empresaId);
  }

  /**
   * Actualizar datos de un usuario en una empresa
   */
  async actualizarUsuario(
    empresaId: string,
    usuarioId: string,
    updateUsuarioDto: any,
    modificadoPor?: string,
  ): Promise<UsuarioResponseDto> {
    // Verificar que el usuario existe en esta empresa
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId,
        empresaId,
        deletedAt: null,
      },
      include: {
        usuario: {
          include: {
            persona: true,
          },
        },
      },
    });

    if (!empresaUsuario) {
      throw new NotFoundException('Usuario no encontrado en esta empresa');
    }

    const {
      nombres,
      apellidos,
      email,
      telefono,
      direccion,
      distrito,
      provincia,
      departamento,
      rol,
      sedeIds,
      puedeAbrirCaja,
      puedeCerrarCaja,
      limiteCreditoVenta,
      permisos,
      accesosRapidosOcultos,
    } = updateUsuarioDto;

    // Validar email único (si está cambiando)
    if (email && email !== empresaUsuario.usuario.email) {
      const usuarioConEmail = await this.prisma.usuario.findUnique({
        where: { email },
      });
      if (usuarioConEmail && usuarioConEmail.id !== usuarioId) {
        throw new ConflictException(
          'Ya existe un usuario registrado con ese email',
        );
      }
    }

    // Validar teléfono único (si está cambiando)
    if (telefono && telefono !== empresaUsuario.usuario.telefono) {
      const usuarioConTelefono = await this.prisma.usuario.findUnique({
        where: { telefono },
      });
      if (usuarioConTelefono && usuarioConTelefono.id !== usuarioId) {
        throw new ConflictException(
          'Ya existe un usuario registrado con ese teléfono',
        );
      }
    }

    // Validar sedes si se están actualizando
    if (sedeIds && sedeIds.length > 0) {
      await this.validarSedesEmpresa(sedeIds, empresaId);
    }

    // Actualizar en transacción
    await this.prisma.$transaction(async (prisma) => {
      // Actualizar datos de la persona si hay cambios
      if (nombres || apellidos || email || telefono || direccion !== undefined || distrito !== undefined || provincia !== undefined || departamento !== undefined) {
        await prisma.persona.update({
          where: { id: empresaUsuario.usuario.personaId },
          data: {
            ...(nombres && { nombres }),
            ...(apellidos && { apellidos }),
            ...(email && { email }),
            ...(telefono && { telefono }),
            ...(direccion !== undefined && { direccion }),
            ...(distrito !== undefined && { distrito }),
            ...(provincia !== undefined && { provincia }),
            ...(departamento !== undefined && { departamento }),
          },
        });
      }

      // Actualizar datos del usuario
      if (email || telefono) {
        await prisma.usuario.update({
          where: { id: usuarioId },
          data: {
            ...(email && { email }),
            ...(telefono && { telefono }),
          },
        });
      }

      // Actualizar rol en la empresa si cambió
      if (rol && rol !== empresaUsuario.rol) {
        await prisma.empresaUsuarioRol.update({
          where: { id: empresaUsuario.id },
          data: {
            rol,
            modificadoPor,
          },
        });
      }

      // Actualizar sedes si se proporcionaron
      if (sedeIds) {
        // Eliminar sedes actuales (soft delete)
        await prisma.usuarioSedeRol.updateMany({
          where: {
            usuarioId,
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
            modificadoPor,
          },
        });

        // Crear nuevas asignaciones de sedes
        if (sedeIds.length > 0) {
          const sedeRole = this.mapRolToSedeRole(rol || empresaUsuario.rol);

          await prisma.usuarioSedeRol.createMany({
            data: sedeIds.map((sedeId) => ({
              usuarioId,
              sedeId,
              rol: sedeRole,
              puedeAbrirCaja: puedeAbrirCaja ?? false,
              puedeCerrarCaja: puedeCerrarCaja ?? false,
              limiteCreditoVenta,
              permisos: permisos ?? [],
              accesosRapidosOcultos: accesosRapidosOcultos ?? [],
              creadoPor: modificadoPor,
            })),
          });
        }
      } else if (
        puedeAbrirCaja !== undefined ||
        puedeCerrarCaja !== undefined ||
        limiteCreditoVenta !== undefined ||
        permisos !== undefined ||
        accesosRapidosOcultos !== undefined
      ) {
        // Si no se cambian sedes pero sí configuración de caja/permisos
        await prisma.usuarioSedeRol.updateMany({
          where: {
            usuarioId,
            isActive: true,
            deletedAt: null,
          },
          data: {
            ...(puedeAbrirCaja !== undefined && { puedeAbrirCaja }),
            ...(puedeCerrarCaja !== undefined && { puedeCerrarCaja }),
            ...(limiteCreditoVenta !== undefined && { limiteCreditoVenta }),
            ...(permisos !== undefined && { permisos }),
            ...(accesosRapidosOcultos !== undefined && { accesosRapidosOcultos }),
            modificadoPor,
          },
        });
      }
    });

    // Invalidar caché de acceso (rol pudo haber cambiado)
    await this.cache.invalidateTenantAccess(usuarioId, empresaId);

    this.logger.log(
      `Usuario ${usuarioId} actualizado en empresa ${empresaId} por usuario ${modificadoPor}`,
    );

    // Retornar usuario actualizado
    return this.obtenerUsuarioCompleto(usuarioId, empresaId);
  }

  /**
   * Desactivar un usuario de una empresa (soft delete)
   */
  async desactivarUsuario(
    empresaId: string,
    usuarioId: string,
    modificadoPor?: string,
  ): Promise<{ mensaje: string }> {
    // Verificar que el usuario existe en esta empresa
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!empresaUsuario) {
      throw new NotFoundException('Usuario no encontrado en esta empresa');
    }

    // Desactivar en transacción
    await this.prisma.$transaction(async (prisma) => {
      // Soft delete en EmpresaUsuarioRol
      await prisma.empresaUsuarioRol.update({
        where: { id: empresaUsuario.id },
        data: {
          deletedAt: new Date(),
          estado: 'INACTIVO',
          modificadoPor,
        },
      });

      // Soft delete en todas las UsuarioSedeRol de esta empresa
      const sedes = await prisma.usuarioSedeRol.findMany({
        where: {
          usuarioId,
          deletedAt: null,
        },
        include: {
          sede: {
            select: {
              empresaId: true,
            },
          },
        },
      });

      const sedesEmpresa = sedes
        .filter((s) => s.sede.empresaId === empresaId)
        .map((s) => s.id);

      if (sedesEmpresa.length > 0) {
        await prisma.usuarioSedeRol.updateMany({
          where: {
            id: { in: sedesEmpresa },
          },
          data: {
            deletedAt: new Date(),
            isActive: false,
            modificadoPor,
          },
        });
      }
    });

    // Invalidar caché de acceso (usuario ya no tiene acceso)
    await this.cache.invalidateTenantAccess(usuarioId, empresaId);

    this.logger.log(
      `Usuario ${usuarioId} desactivado en empresa ${empresaId} por usuario ${modificadoPor}`,
    );

    return {
      mensaje: 'Usuario desactivado exitosamente de la empresa',
    };
  }
}
