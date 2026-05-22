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
import { Prisma, Rol, SedeRole } from '@prisma/client';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { CacheService } from '../redis/cache.service';
import { AuthSessionService } from '../auth/auth.session.service';
import { VALID_GRANULAR_PERMISSION_IDS } from '../auth/services/granular-permissions.catalog';

@Injectable()
export class UsuariosService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private planLimitsService: PlanLimitsService,
    private cache: CacheService,
    loggerService: AppLoggerService,
    private authSessionService: AuthSessionService,
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

    // (Validación de sedes movida a cada CASO, dentro de su $transaction
    // — cierra TOCTOU contra un admin desactivando sede entre check y use.)

    // Log de drift de catálogo (no bloqueante).
    this.logIdsDesconocidos(createUsuarioDto.permisos, 'registrarUsuario');

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

        const usuarioPromovidoId = personaExistente.usuario!.id;
        const personaIdPromovido = personaExistente.id;

        // Toda la promoción en un solo $transaction: si cualquiera de
        // los 4 pasos falla, no queda el rol parcialmente promovido
        // sin sedes ni con EmpresaPersona/rolGlobal desincronizados.
        await this.prisma.$transaction(async (prisma) => {
          // Validar sedes adentro de la tx para cerrar TOCTOU contra
          // un admin que desactiva la sede entre check y upsert.
          if (sedeIds && sedeIds.length > 0) {
            await this.validarSedesEmpresa(sedeIds, empresaId, prisma);
          }

          // 1) Rol en EmpresaUsuarioRol
          await prisma.empresaUsuarioRol.update({
            where: { id: empresaRol.id },
            data: { rol, registradoPor },
          });

          // 2) Rol en EmpresaPersona (estaba como CLIENTE → EMPLEADO).
          //    Sin este sync, consultas que filtran por EmpresaPersona.rol
          //    siguen viendo al usuario como cliente.
          await prisma.empresaPersona.updateMany({
            where: { personaId: personaIdPromovido, empresaId },
            data: { rol: 'EMPLEADO' },
          });

          // 3) rolGlobal del Usuario. El JWT y guards globales lo leen
          //    desde acá; sin esto seguiría siendo CLIENTE.
          await prisma.usuario.update({
            where: { id: usuarioPromovidoId },
            data: { rolGlobal: rol },
          });

          // 4) Asignar sedes (upsert para soportar UsuarioSedeRol
          //    soft-deleted previo: createMany reventaría con el
          //    unique constraint (usuarioId, sedeId) que no filtra por
          //    deletedAt).
          if (sedeIds && sedeIds.length > 0) {
            const sedeRole = this.mapRolToSedeRole(rol);
            for (const sedeId of sedeIds) {
              await prisma.usuarioSedeRol.upsert({
                where: {
                  usuarioId_sedeId: { usuarioId: usuarioPromovidoId, sedeId },
                },
                create: {
                  usuarioId: usuarioPromovidoId,
                  sedeId,
                  rol: sedeRole,
                  puedeAbrirCaja: createUsuarioDto.puedeAbrirCaja ?? false,
                  puedeCerrarCaja: createUsuarioDto.puedeCerrarCaja ?? false,
                  limiteCreditoVenta: createUsuarioDto.limiteCreditoVenta,
                  permisos: createUsuarioDto.permisos ?? [],
                  accesosRapidosOcultos:
                    createUsuarioDto.accesosRapidosOcultos ?? [],
                  creadoPor: registradoPor,
                },
                update: {
                  rol: sedeRole,
                  puedeAbrirCaja: createUsuarioDto.puedeAbrirCaja ?? false,
                  puedeCerrarCaja: createUsuarioDto.puedeCerrarCaja ?? false,
                  limiteCreditoVenta: createUsuarioDto.limiteCreditoVenta,
                  permisos: createUsuarioDto.permisos ?? [],
                  accesosRapidosOcultos:
                    createUsuarioDto.accesosRapidosOcultos ?? [],
                  // Reactivar si previamente estaba soft-deleted.
                  deletedAt: null,
                  isActive: true,
                  modificadoPor: registradoPor,
                },
              });
            }
          }
        });

        usuario = { id: usuarioPromovidoId };

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
   * Loguea warning si el payload trae IDs de `permisos` que no están
   * en el catálogo granular. No rechaza para no romper deploys donde
   * el cliente Flutter va adelante del backend (o viceversa), pero
   * deja huella en logs para detectar drift de catálogo o llamadas
   * mal-formadas. `accesosRapidosOcultos` no se valida porque su
   * catálogo vive solo en Flutter (UI-only).
   */
  private logIdsDesconocidos(
    permisos: string[] | undefined,
    contexto: string,
  ): void {
    if (!permisos || permisos.length === 0) return;
    const desconocidos = permisos.filter(
      (p) => !VALID_GRANULAR_PERMISSION_IDS.has(p),
    );
    if (desconocidos.length > 0) {
      this.logger.warn(
        `[${contexto}] IDs de permiso granular fuera de catálogo: ${desconocidos.join(', ')}`,
      );
    }
  }

  /**
   * Valida que email y teléfono sean únicos tanto en Usuario como en
   * Persona. Sin el check en Persona, el CASO 3 (persona existente sin
   * usuario, donde el flujo termina haciendo `persona.update({ email })`)
   * reventaba con unique constraint cruda de Prisma en lugar de un
   * ConflictException amigable.
   */
  private async validarEmailTelefonoUnicos(
    email?: string,
    telefono?: string,
  ): Promise<void> {
    if (email) {
      const [usuarioConEmail, personaConEmail] = await Promise.all([
        this.prisma.usuario.findUnique({ where: { email } }),
        this.prisma.persona.findFirst({ where: { email } }),
      ]);
      if (usuarioConEmail || personaConEmail) {
        throw new ConflictException(
          'Ya existe un usuario registrado con ese email',
        );
      }
    }

    if (telefono) {
      const [usuarioConTelefono, personaConTelefono] = await Promise.all([
        this.prisma.usuario.findUnique({ where: { telefono } }),
        this.prisma.persona.findFirst({ where: { telefono } }),
      ]);
      if (usuarioConTelefono || personaConTelefono) {
        throw new ConflictException(
          'Ya existe un usuario registrado con ese teléfono',
        );
      }
    }
  }

  /**
   * Valida que todas las sedes pertenezcan a la empresa. Acepta un
   * cliente prisma transaccional opcional para correr el check dentro
   * de la misma tx que el upsert/createMany de UsuarioSedeRol y cerrar
   * la ventana TOCTOU (otro admin desactivando sede entre check y use).
   */
  private async validarSedesEmpresa(
    sedeIds: string[],
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const sedesValidas = await client.sede.findMany({
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
      // Validar sedes adentro de la tx (cierra TOCTOU).
      if (sedeIds && sedeIds.length > 0) {
        await this.validarSedesEmpresa(sedeIds, empresaId, prisma);
      }

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
      // Validar sedes adentro de la tx (cierra TOCTOU).
      if (sedeIds && sedeIds.length > 0) {
        await this.validarSedesEmpresa(sedeIds, empresaId, prisma);
      }

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
          aliasTicket: createUsuarioDto.aliasTicket || null,
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
      // Validar sedes adentro de la tx (cierra TOCTOU).
      if (sedeIds && sedeIds.length > 0) {
        await this.validarSedesEmpresa(sedeIds, empresaId, prisma);
      }

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
          aliasTicket: createUsuarioDto.aliasTicket || null,
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
    // No filtrar por `deletedAt: null` aquí: el panel necesita poder
    // ver los detalles de un usuario desactivado para poder mostrarle
    // al admin el botón "Reactivar".
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId,
        empresaId,
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
      aliasTicket: usuario.aliasTicket || undefined,
      direccion: persona.direccion || undefined,
      distrito: persona.distrito || undefined,
      provincia: persona.provincia || undefined,
      departamento: persona.departamento || undefined,
      rolEnEmpresa: empresaUsuario.rol,
      rolGlobal: usuario.rolGlobal || undefined,
      // `isActive` refleja estado del usuario EN ESTA EMPRESA (vínculo
      // no soft-deleted + estado ACTIVO + Usuario global activo).
      isActive:
        empresaUsuario.deletedAt === null &&
        empresaUsuario.estado === 'ACTIVO' &&
        usuario.isActive === true,
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
      // Excluir clientes — solo mostrar staff/empleados
      rol: { not: Rol.CLIENTE },
    };

    // Filtro por rol
    if (rol) {
      where.rol = rol;
    }

    // Filtro por estado: el DTO recibe `isActive` como STRING porque
    // NestJS tiene enableImplicitConversion=true que rompe el cast a
    // boolean (Boolean('false') === true).
    // - 'true': solo activos en la empresa (no soft-deleted, estado=ACTIVO).
    // - 'false': solo inactivos = soft-deleted O Usuario.isActive=false.
    // - undefined: TODOS (sin filtro de estado). El cliente decide
    //   cuándo enviar 'true' por default; aquí no asumimos nada.
    if (isActive === 'true') {
      where.deletedAt = null;
      where.usuario = { isActive: true };
    } else if (isActive === 'false') {
      where.OR = [
        { deletedAt: { not: null } },
        { usuario: { isActive: false } },
      ];
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
        // `isActive` refleja el estado del usuario EN ESTA EMPRESA, no
        // el flag global de Usuario. Activo = vínculo no soft-deleted +
        // estado ACTIVO + Usuario global no deshabilitado por super
        // admin. Esto es lo que el panel de empresa muestra y filtra.
        isActive:
          eu.deletedAt === null &&
          eu.estado === 'ACTIVO' &&
          usuario.isActive === true,
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
      aliasTicket,
    } = updateUsuarioDto;

    // No permitir degradar empleados a CLIENTE desde este endpoint.
    // El módulo de clientes maneja su propio ciclo de vida y este PATCH
    // dejaría al usuario en estado inconsistente (CLIENTE con
    // UsuarioSedeRol activos, flags de caja, etc.).
    if (rol === Rol.CLIENTE) {
      throw new BadRequestException(
        'No se puede asignar el rol CLIENTE desde este endpoint. Use el módulo de clientes.',
      );
    }

    // Log de drift de catálogo (no bloqueante).
    this.logIdsDesconocidos(permisos, 'actualizarUsuario');

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

    // Detectar si el cambio impacta permisos/rol → revocar sesiones
    // post-tx para que el JWT/sesión activa no siga con permisos viejos
    // (la invalidación de cache sola no alcanza, el JWT vive hasta
    // expirar). Sobre-revocamos si el admin reenvía el mismo valor,
    // pero es operación poco frecuente y la revocación es barata.
    const rolCambia = rol !== undefined && rol !== empresaUsuario.rol;
    const permisosOFlagsTocados =
      permisos !== undefined ||
      accesosRapidosOcultos !== undefined ||
      puedeAbrirCaja !== undefined ||
      puedeCerrarCaja !== undefined;
    const debeRevocarSesiones = rolCambia || permisosOFlagsTocados;

    // Actualizar en transacción
    await this.prisma.$transaction(async (prisma) => {
      // Validar sedes adentro de la tx — cierra TOCTOU contra admin
      // desactivando sede entre el check y el upsert.
      if (sedeIds && sedeIds.length > 0) {
        await this.validarSedesEmpresa(sedeIds, empresaId, prisma);
      }

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
      // `aliasTicket === ''` se interpreta como "borrar alias" → guardar null
      // para que el ticket vuelva al nombre completo de la persona.
      if (email || telefono || aliasTicket !== undefined) {
        await prisma.usuario.update({
          where: { id: usuarioId },
          data: {
            ...(email && { email }),
            ...(telefono && { telefono }),
            ...(aliasTicket !== undefined && {
              aliasTicket: aliasTicket === '' ? null : aliasTicket,
            }),
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

        // Sincronizar Usuario.rolGlobal — el JWT y guards globales lo
        // leen desde acá, sin esto seguiría con el rol viejo.
        await prisma.usuario.update({
          where: { id: usuarioId },
          data: { rolGlobal: rol },
        });
      }

      // Actualizar sedes si se proporcionaron.
      //
      // El schema tiene `@@unique([usuarioId, sedeId])` sin filtrar por
      // deletedAt, así que soft-delete + create con misma (usuarioId,
      // sedeId) revienta por unique constraint. Estrategia: para cada
      // sede del payload hacer UPSERT (reactivando si estaba soft-deleted),
      // y soft-delete solo las sedes que ya no están en el payload.
      if (sedeIds) {
        if (sedeIds.length > 0) {
          const sedeRole = this.mapRolToSedeRole(rol || empresaUsuario.rol);

          for (const sedeId of sedeIds) {
            await prisma.usuarioSedeRol.upsert({
              where: {
                usuarioId_sedeId: { usuarioId, sedeId },
              },
              create: {
                usuarioId,
                sedeId,
                rol: sedeRole,
                puedeAbrirCaja: puedeAbrirCaja ?? false,
                puedeCerrarCaja: puedeCerrarCaja ?? false,
                limiteCreditoVenta,
                permisos: permisos ?? [],
                accesosRapidosOcultos: accesosRapidosOcultos ?? [],
                creadoPor: modificadoPor,
              },
              update: {
                rol: sedeRole,
                ...(puedeAbrirCaja !== undefined && { puedeAbrirCaja }),
                ...(puedeCerrarCaja !== undefined && { puedeCerrarCaja }),
                ...(limiteCreditoVenta !== undefined && { limiteCreditoVenta }),
                ...(permisos !== undefined && { permisos }),
                ...(accesosRapidosOcultos !== undefined && {
                  accesosRapidosOcultos,
                }),
                // Reactivar si previamente estaba soft-deleted/inactivo.
                deletedAt: null,
                isActive: true,
                modificadoPor,
              },
            });
          }
        }

        // Soft-delete sedes que el usuario tenía pero ya no están en el payload.
        await prisma.usuarioSedeRol.updateMany({
          where: {
            usuarioId,
            sedeId: { notIn: sedeIds },
            deletedAt: null,
          },
          data: {
            deletedAt: new Date(),
            modificadoPor,
          },
        });
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

    // Si cambió rol/permisos, revocar sesiones del usuario en esta
    // empresa. Sin esto el JWT activo sigue con permisos viejos hasta
    // expirar — el cache solo aplica a checks server-side, no al JWT.
    let sesionesRevocadas = 0;
    if (debeRevocarSesiones) {
      sesionesRevocadas =
        await this.authSessionService.revokeUserSessionsByTenant(
          usuarioId,
          empresaId,
        );
    }

    this.logger.log(
      `Usuario ${usuarioId} actualizado en empresa ${empresaId} por usuario ${modificadoPor}` +
        (debeRevocarSesiones
          ? `. Sesiones revocadas por cambio de rol/permisos: ${sesionesRevocadas}`
          : ''),
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

    // Cerrar sesiones del empleado en esta empresa para corte inmediato.
    // Sólo revocamos las sesiones cuyo `tenantId` coincide: si el usuario
    // está activo en otra empresa, esas sesiones siguen vivas.
    const sesionesRevocadas =
      await this.authSessionService.revokeUserSessionsByTenant(
        usuarioId,
        empresaId,
      );

    this.logger.log(
      `Usuario ${usuarioId} desactivado en empresa ${empresaId} por usuario ${modificadoPor}. Sesiones revocadas: ${sesionesRevocadas}`,
    );

    return {
      mensaje: 'Usuario desactivado exitosamente de la empresa',
    };
  }

  /**
   * Reactivar un usuario previamente desactivado en una empresa.
   * Revierte el soft-delete: pone `deletedAt=null`, `estado=ACTIVO` y
   * reactiva las UsuarioSedeRol que se habían soft-deleted en la misma
   * empresa. El usuario podrá iniciar sesión nuevamente.
   */
  async reactivarUsuario(
    empresaId: string,
    usuarioId: string,
    modificadoPor?: string,
  ): Promise<{ mensaje: string }> {
    // Buscar el EmpresaUsuarioRol incluso si está soft-deleted
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId,
        empresaId,
      },
    });

    if (!empresaUsuario) {
      throw new NotFoundException('Usuario no encontrado en esta empresa');
    }

    if (empresaUsuario.deletedAt === null && empresaUsuario.estado === 'ACTIVO') {
      throw new BadRequestException('El usuario ya está activo en esta empresa');
    }

    // Reactivar en transacción
    await this.prisma.$transaction(async (prisma) => {
      // Restaurar EmpresaUsuarioRol
      await prisma.empresaUsuarioRol.update({
        where: { id: empresaUsuario.id },
        data: {
          deletedAt: null,
          estado: 'ACTIVO',
          modificadoPor,
        },
      });

      // Restaurar UsuarioSedeRol soft-deleted que pertenecen a sedes de esta empresa
      const sedes = await prisma.usuarioSedeRol.findMany({
        where: {
          usuarioId,
          deletedAt: { not: null },
        },
        include: {
          sede: { select: { empresaId: true } },
        },
      });

      const sedesEmpresa = sedes
        .filter((s) => s.sede.empresaId === empresaId)
        .map((s) => s.id);

      if (sedesEmpresa.length > 0) {
        await prisma.usuarioSedeRol.updateMany({
          where: { id: { in: sedesEmpresa } },
          data: {
            deletedAt: null,
            isActive: true,
            modificadoPor,
          },
        });
      }
    });

    // Invalidar caché de tenant access para que el guard vuelva a permitir
    await this.cache.invalidateTenantAccess(usuarioId, empresaId);
    // Invalidar cache `user:active:` por si tenía el valor `0` cacheado
    // de un intento previo: si el usuario fue desactivado y reactivado
    // dentro de 30s, el JwtStrategy seguiría viéndolo inactivo.
    await this.authSessionService.invalidateUserActiveCache(usuarioId);

    this.logger.log(
      `Usuario ${usuarioId} reactivado en empresa ${empresaId} por usuario ${modificadoPor}`,
    );

    return {
      mensaje: 'Usuario reactivado exitosamente en la empresa',
    };
  }
}
