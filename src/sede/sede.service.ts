import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditLoggerService, AuditAction } from '../common/logger/audit-logger.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { Rol, TipoSede } from '@prisma/client';
import { CreateSedeDto, UpdateSedeDto, SedeDetailDto, AsignarUsuarioSedeDto } from './dto';

@Injectable()
export class SedeService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly auditLogger: AuditLoggerService,
    private readonly configuracionCodigosService: ConfiguracionCodigosService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(SedeService.name);
  }

  /**
   * Crear nueva sede
   * Valida límites según plan de suscripción
   */
  async createSede(
    empresaId: string,
    userId: string,
    data: CreateSedeDto,
  ): Promise<SedeDetailDto> {
    this.logger.info('Creating new sede', { empresaId, userId, nombre: data.nombre });

    // Verificar que el usuario tenga permisos de administrador en la empresa
    await this.verificarPermisoAdmin(empresaId, userId);

    // Verificar límites del plan de suscripción
    await this.verificarLimitesSedes(empresaId);

    // Generar código automáticamente usando el servicio centralizado
    // El código NO puede ser especificado por el usuario, siempre se genera automáticamente
    const codigo = (await this.configuracionCodigosService.generarCodigoSede(empresaId)).codigoSede;

    // Auto-generar series basadas en las series existentes si no se proporcionan
    const seriesGeneradas = await this.generarSeriesDesdeCodigo(codigo, data, empresaId);

    // Validar series de comprobantes únicas
    await this.validarSeriesUnicas(empresaId, seriesGeneradas);

    // Crear la sede
    const sede = await this.prisma.sede.create({
      data: {
        empresaId,
        codigo,
        nombre: data.nombre,
        telefono: data.telefono,
        email: data.email,
        tipoSede: data.tipoSede,
        direccion: data.direccion,
        referencia: data.referencia,
        stand: data.stand || undefined,
        distrito: data.distrito,
        provincia: data.provincia,
        departamento: data.departamento,
        pais: data.pais || 'PERU',
        coordenadas: data.coordenadas || undefined,
        imagenes: data.imagenes || undefined,
        horarioAtencion: data.horarioAtencion || undefined,
        configuracion: data.configuracion || undefined,
        serieFactura: seriesGeneradas.serieFactura,
        serieBoleta: seriesGeneradas.serieBoleta,
        serieNotaCredito: seriesGeneradas.serieNotaCredito,
        serieNotaDebito: seriesGeneradas.serieNotaDebito,
        serieGuiaRemision: seriesGeneradas.serieGuiaRemision,
        // Facturación electrónica por sede
        rucSede: data.rucSede,
        razonSocialSede: data.razonSocialSede,
        direccionFiscalSede: data.direccionFiscalSede,
        proveedorRuta: data.proveedorRuta,
        proveedorToken: data.proveedorToken,
        facturacionActiva: data.facturacionActiva,
        resolucionSunat: data.resolucionSunat,
        ultimoNumeroFactura: 0,
        ultimoNumeroBoleta: 0,
        ultimoNumeroNotaCredito: 0,
        ultimoNumeroNotaDebito: 0,
        ultimoNumeroGuiaRemision: 0,
        isActive: data.isActive !== undefined ? data.isActive : true,
        esPrincipal: false, // Las nuevas sedes nunca son principales
      },
      include: {
        usuarios: true,
        productos: true,
        servicios: true,
      },
    });

    this.logger.success('Sede created successfully', {
      sedeId: sede.id,
      empresaId,
      codigo: sede.codigo,
    });

    // Auditoría
    this.auditLogger.log({
      action: AuditAction.TENANT_CREATED,
      actor: { userId },
      target: {
        type: 'Sede',
        id: sede.id,
        name: sede.nombre,
      },
      metadata: {
        empresaId,
        codigo: sede.codigo,
        tipoSede: sede.tipoSede,
      },
      success: true,
    });

    return this.formatSedeDetail(sede);
  }

  /**
   * Listar todas las sedes de una empresa
   */
  async listSedes(empresaId: string, userId: string): Promise<SedeDetailDto[]> {
    this.logger.info('Listing sedes for empresa', { empresaId, userId });

    // Verificar acceso del usuario a la empresa
    await this.verificarAccesoEmpresa(empresaId, userId);

    const sedes = await this.prisma.sede.findMany({
      where: {
        empresaId,
        deletedAt: null,
      },
      include: {
        usuarios: {
          where: { usuarioId: userId },
        },
        _count: {
          select: {
            usuarios: true,
            productos: true,
            servicios: true,
          },
        },
      },
      orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }],
    });

    return sedes.map((sede) => this.formatSedeDetail(sede));
  }

  /**
   * Obtener detalles de una sede específica
   */
  async getSede(
    empresaId: string,
    sedeId: string,
    userId: string,
  ): Promise<SedeDetailDto> {
    this.logger.info('Getting sede details', { empresaId, sedeId, userId });

    // Verificar acceso
    await this.verificarAccesoEmpresa(empresaId, userId);

    const sede = await this.prisma.sede.findFirst({
      where: {
        id: sedeId,
        empresaId,
        deletedAt: null,
      },
      include: {
        usuarios: {
          where: { usuarioId: userId },
        },
        _count: {
          select: {
            usuarios: true,
            productos: true,
            servicios: true,
          },
        },
      },
    });

    if (!sede) {
      throw new NotFoundException('Sede no encontrada');
    }

    return this.formatSedeDetail(sede);
  }

  /**
   * Actualizar sede
   */
  async updateSede(
    empresaId: string,
    sedeId: string,
    userId: string,
    data: UpdateSedeDto,
  ): Promise<SedeDetailDto> {
    this.logger.info('Updating sede', { empresaId, sedeId, userId });

    // Verificar permisos de administrador
    await this.verificarPermisoAdmin(empresaId, userId);

    // Verificar que la sede existe
    const sedeExistente = await this.prisma.sede.findFirst({
      where: {
        id: sedeId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!sedeExistente) {
      throw new NotFoundException('Sede no encontrada');
    }

    // El código NO se puede modificar, se ignora si viene en el request
    // Si se están actualizando series, validar unicidad
    if (
      data.serieFactura ||
      data.serieBoleta ||
      data.serieNotaCredito ||
      data.serieNotaDebito ||
      data.serieGuiaRemision
    ) {
      await this.validarSeriesUnicas(
        empresaId,
        {
          serieFactura: data.serieFactura || sedeExistente.serieFactura,
          serieBoleta: data.serieBoleta || sedeExistente.serieBoleta,
          serieNotaCredito: data.serieNotaCredito || sedeExistente.serieNotaCredito,
          serieNotaDebito: data.serieNotaDebito || sedeExistente.serieNotaDebito,
          serieGuiaRemision: data.serieGuiaRemision || sedeExistente.serieGuiaRemision,
        },
        sedeId,
      );

      // Validar que no haya comprobantes pendientes con series que se están cambiando
      const seriesCambiadas: string[] = [];
      if (data.serieFactura && data.serieFactura !== sedeExistente.serieFactura) seriesCambiadas.push(sedeExistente.serieFactura);
      if (data.serieBoleta && data.serieBoleta !== sedeExistente.serieBoleta) seriesCambiadas.push(sedeExistente.serieBoleta);
      if (data.serieNotaCredito && data.serieNotaCredito !== sedeExistente.serieNotaCredito) seriesCambiadas.push(sedeExistente.serieNotaCredito);
      if (data.serieNotaDebito && data.serieNotaDebito !== sedeExistente.serieNotaDebito) seriesCambiadas.push(sedeExistente.serieNotaDebito);

      if (seriesCambiadas.length > 0) {
        const pendientes = await this.prisma.comprobanteElectronico.count({
          where: {
            empresaId,
            serie: { in: seriesCambiadas },
            sunatStatus: { in: ['PENDIENTE', 'ERROR_COMUNICACION', 'PROCESANDO'] },
          },
        });
        if (pendientes > 0) {
          throw new BadRequestException(
            `No se puede cambiar la serie: hay ${pendientes} comprobante(s) pendientes de envío con la serie anterior. Envíelos primero desde el Monitor de Facturación.`,
          );
        }
      }
    }

    // Actualizar sede (el código NO se actualiza, se mantiene el original)
    const sedeActualizada = await this.prisma.sede.update({
      where: { id: sedeId },
      data: {
        nombre: data.nombre,
        // codigo: NO se actualiza - se mantiene el generado automáticamente
        telefono: data.telefono,
        email: data.email,
        tipoSede: data.tipoSede,
        direccion: data.direccion,
        referencia: data.referencia,
        stand: data.stand,
        distrito: data.distrito,
        provincia: data.provincia,
        departamento: data.departamento,
        pais: data.pais,
        coordenadas: data.coordenadas || undefined,
        imagenes: data.imagenes,
        horarioAtencion: data.horarioAtencion || undefined,
        configuracion: data.configuracion || undefined,
        serieFactura: data.serieFactura,
        serieBoleta: data.serieBoleta,
        serieNotaCredito: data.serieNotaCredito,
        serieNotaDebito: data.serieNotaDebito,
        serieGuiaRemision: data.serieGuiaRemision,
        // Facturación electrónica por sede
        rucSede: data.rucSede,
        razonSocialSede: data.razonSocialSede,
        direccionFiscalSede: data.direccionFiscalSede,
        proveedorRuta: data.proveedorRuta,
        proveedorToken: data.proveedorToken,
        facturacionActiva: data.facturacionActiva,
        resolucionSunat: data.resolucionSunat,
        isActive: data.isActive,
      },
      include: {
        usuarios: true,
        _count: {
          select: {
            usuarios: true,
            productos: true,
            servicios: true,
          },
        },
      },
    });

    this.logger.success('Sede updated successfully', { sedeId, empresaId });

    // Auditoría
    this.auditLogger.log({
      action: AuditAction.TENANT_UPDATED,
      actor: { userId },
      target: {
        type: 'Sede',
        id: sedeId,
        name: sedeActualizada.nombre,
      },
      metadata: {
        empresaId,
        changes: data,
      },
      success: true,
    });

    return this.formatSedeDetail(sedeActualizada);
  }

  /**
   * Eliminar sede (soft delete)
   */
  async deleteSede(empresaId: string, sedeId: string, userId: string): Promise<void> {
    this.logger.info('Deleting sede', { empresaId, sedeId, userId });

    // Verificar permisos de administrador
    await this.verificarPermisoAdmin(empresaId, userId);

    // Verificar que la sede existe
    const sede = await this.prisma.sede.findFirst({
      where: {
        id: sedeId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!sede) {
      throw new NotFoundException('Sede no encontrada');
    }

    // No permitir eliminar la sede principal
    if (sede.esPrincipal) {
      throw new BadRequestException(
        'No se puede eliminar la sede principal. Primero asigna otra sede como principal.',
      );
    }

    // Verificar si hay productos o servicios asignados (opcional: podrías permitirlo con una flag)
    const productosCount = await this.prisma.producto.count({
      where: {
        sedeId: sedeId,
        deletedAt: null,
      },
    });

    const serviciosCount = await this.prisma.servicio.count({
      where: {
        sedeId: sedeId,
        deletedAt: null,
      },
    });

    if (productosCount > 0 || serviciosCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar la sede porque tiene ${productosCount} productos y ${serviciosCount} servicios asociados. Por favor, reasígnalos primero.`,
      );
    }

    // Soft delete
    await this.prisma.sede.update({
      where: { id: sedeId },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    this.logger.success('Sede deleted successfully', { sedeId, empresaId });

    // Auditoría
    this.auditLogger.log({
      action: AuditAction.TENANT_DELETED,
      actor: { userId },
      target: {
        type: 'Sede',
        id: sedeId,
        name: sede.nombre,
      },
      metadata: { empresaId },
      success: true,
    });
  }

  /**
   * Asignar usuario a una sede con un rol específico
   */
  async asignarUsuarioSede(
    empresaId: string,
    sedeId: string,
    userId: string,
    data: AsignarUsuarioSedeDto,
  ): Promise<any> {
    this.logger.info('Assigning user to sede', {
      empresaId,
      sedeId,
      usuarioId: data.usuarioId,
      rol: data.rol,
    });

    // Verificar permisos de administrador
    await this.verificarPermisoAdmin(empresaId, userId);

    // Verificar que la sede existe
    const sede = await this.prisma.sede.findFirst({
      where: {
        id: sedeId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!sede) {
      throw new NotFoundException('Sede no encontrada');
    }

    // Verificar que el usuario está asociado a la empresa
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: data.usuarioId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!empresaUsuario) {
      throw new BadRequestException(
        'El usuario no está asociado a esta empresa. Primero debes agregarlo a la empresa.',
      );
    }

    // Verificar si ya existe una asignación
    const existeAsignacion = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId: data.usuarioId,
        sedeId,
      },
    });

    let asignacion;

    if (existeAsignacion) {
      // Actualizar asignación existente
      asignacion = await this.prisma.usuarioSedeRol.update({
        where: { id: existeAsignacion.id },
        data: {
          rol: data.rol,
          permisos: data.permisos || [],
          isActive: data.isActive !== undefined ? data.isActive : true,
          puedeAbrirCaja: data.puedeAbrirCaja || false,
          puedeCerrarCaja: data.puedeCerrarCaja || false,
          limiteCreditoVenta: data.limiteCreditoVenta || null,
          modificadoPor: userId,
          deletedAt: null, // Reactivar si estaba eliminado
        },
        include: {
          usuario: {
            select: {
              id: true,
              email: true,
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          },
        },
      });

      this.logger.info('User sede role updated', { asignacionId: asignacion.id });
    } else {
      // Crear nueva asignación
      asignacion = await this.prisma.usuarioSedeRol.create({
        data: {
          usuarioId: data.usuarioId,
          sedeId,
          rol: data.rol,
          permisos: data.permisos || [],
          isActive: data.isActive !== undefined ? data.isActive : true,
          puedeAbrirCaja: data.puedeAbrirCaja || false,
          puedeCerrarCaja: data.puedeCerrarCaja || false,
          limiteCreditoVenta: data.limiteCreditoVenta || null,
          creadoPor: userId,
          modificadoPor: userId,
        },
        include: {
          usuario: {
            select: {
              id: true,
              email: true,
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          },
        },
      });

      this.logger.success('User assigned to sede', { asignacionId: asignacion.id });
    }

    // Auditoría
    this.auditLogger.log({
      action: existeAsignacion ? AuditAction.TENANT_UPDATED : AuditAction.TENANT_CREATED,
      actor: { userId },
      target: {
        type: 'UsuarioSedeRol',
        id: asignacion.id,
        name: `Usuario asignado a sede ${sede.nombre}`,
      },
      metadata: {
        empresaId,
        sedeId,
        usuarioId: data.usuarioId,
        rol: data.rol,
      },
      success: true,
    });

    return asignacion;
  }

  /**
   * Remover usuario de una sede
   */
  async removerUsuarioSede(
    empresaId: string,
    sedeId: string,
    usuarioSedeRolId: string,
    userId: string,
  ): Promise<void> {
    this.logger.info('Removing user from sede', {
      empresaId,
      sedeId,
      usuarioSedeRolId,
    });

    // Verificar permisos de administrador
    await this.verificarPermisoAdmin(empresaId, userId);

    const asignacion = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        id: usuarioSedeRolId,
        sedeId,
        deletedAt: null,
      },
    });

    if (!asignacion) {
      throw new NotFoundException('Asignación no encontrada');
    }

    // Soft delete
    await this.prisma.usuarioSedeRol.update({
      where: { id: usuarioSedeRolId },
      data: {
        deletedAt: new Date(),
        isActive: false,
        modificadoPor: userId,
      },
    });

    this.logger.success('User removed from sede', { usuarioSedeRolId });

    // Auditoría
    this.auditLogger.log({
      action: AuditAction.TENANT_DELETED,
      actor: { userId },
      target: {
        type: 'UsuarioSedeRol',
        id: usuarioSedeRolId,
        name: 'Usuario removido de sede',
      },
      metadata: { empresaId, sedeId },
      success: true,
    });
  }

  /**
   * Listar usuarios asignados a una sede
   */
  async listarUsuariosSede(
    empresaId: string,
    sedeId: string,
    userId: string,
  ): Promise<any[]> {
    this.logger.info('Listing users for sede', { empresaId, sedeId });

    // Verificar acceso
    await this.verificarAccesoEmpresa(empresaId, userId);

    const usuarios = await this.prisma.usuarioSedeRol.findMany({
      where: {
        sedeId,
        deletedAt: null,
        isActive: true,
      },
      include: {
        usuario: {
          select: {
            id: true,
            email: true,
            telefono: true,
            persona: {
              select: {
                nombres: true,
                apellidos: true,
              },
            },
          },
        },
      },
      orderBy: {
        creadoEn: 'desc',
      },
    });

    return usuarios;
  }

  // ==================== MÉTODOS PRIVADOS ====================

  /**
   * Verificar que el usuario tenga permiso de administrador en la empresa
   */
  private async verificarPermisoAdmin(empresaId: string, userId: string): Promise<void> {
    const esAdmin = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: {
          in: [Rol.SUPER_ADMIN, Rol.EMPRESA_ADMIN],
        },
      },
    });

    if (!esAdmin) {
      throw new ForbiddenException(
        'No tienes permisos para realizar esta acción. Se requiere rol de administrador.',
      );
    }
  }

  /**
   * Verificar que el usuario tenga acceso a la empresa
   */
  private async verificarAccesoEmpresa(empresaId: string, userId: string): Promise<void> {
    const accesoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!accesoEmpresa) {
      throw new ForbiddenException('No tienes acceso a esta empresa');
    }
  }

  /**
   * Verificar límites de sedes según plan de suscripción
   */
  private async verificarLimitesSedes(empresaId: string): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: { planSuscripcion: true },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // Si el plan tiene límite de sedes, verificar
    if (empresa.planSuscripcion?.limiteSedes) {
      const sedesActuales = await this.prisma.sede.count({
        where: {
          empresaId,
          deletedAt: null,
        },
      });

      if (sedesActuales >= empresa.planSuscripcion.limiteSedes) {
        throw new BadRequestException(
          `Has alcanzado el límite de ${empresa.planSuscripcion.limiteSedes} sedes de tu plan "${empresa.planSuscripcion.nombre}". Actualiza tu plan para crear más sedes.`,
        );
      }
    }
  }

  /**
   * Verificar que el código de sede sea único dentro de la empresa
   */
  private async verificarCodigoUnico(
    empresaId: string,
    codigo: string,
    excludeSedeId?: string,
  ): Promise<void> {
    const sedeExistente = await this.prisma.sede.findFirst({
      where: {
        empresaId,
        codigo,
        deletedAt: null,
        ...(excludeSedeId && { id: { not: excludeSedeId } }),
      },
    });

    if (sedeExistente) {
      throw new ConflictException(
        `Ya existe una sede con el código "${codigo}" en esta empresa`,
      );
    }
  }


  /**
   * Generar series de comprobantes basadas en las series existentes
   * Si el usuario proporciona series, las usa; si no, escanea las series existentes
   * y genera el siguiente número disponible
   */
  private async generarSeriesDesdeCodigo(
    codigo: string,
    data: CreateSedeDto,
    empresaId: string,
  ): Promise<{
    serieFactura: string;
    serieBoleta: string;
    serieNotaCredito: string;
    serieNotaDebito: string;
    serieGuiaRemision: string;
  }> {
    // Si el usuario proporcionó todas las series, usarlas
    if (
      data.serieFactura &&
      data.serieBoleta &&
      data.serieNotaCredito &&
      data.serieNotaDebito
    ) {
      return {
        serieFactura: data.serieFactura,
        serieBoleta: data.serieBoleta,
        serieNotaCredito: data.serieNotaCredito,
        serieNotaDebito: data.serieNotaDebito,
        serieGuiaRemision: data.serieGuiaRemision || 'GR01',
      };
    }

    // Buscar el número más alto usado en TODAS las sedes (incluyendo eliminadas)
    const sedes = await this.prisma.sede.findMany({
      where: { empresaId },
      select: {
        serieFactura: true,
        serieBoleta: true,
        serieNotaCredito: true,
        serieNotaDebito: true,
        serieGuiaRemision: true,
      },
    });

    let maxNumeroFactura = 0;
    let maxNumeroBoleta = 0;
    let maxNumeroNC = 0;
    let maxNumeroND = 0;
    let maxNumeroGR = 0;

    for (const sede of sedes) {
      // Extraer números de las series
      const matchF = sede.serieFactura?.match(/F(\d+)/);
      if (matchF) {
        const num = parseInt(matchF[1], 10);
        if (num > maxNumeroFactura) maxNumeroFactura = num;
      }

      const matchB = sede.serieBoleta?.match(/B(\d+)/);
      if (matchB) {
        const num = parseInt(matchB[1], 10);
        if (num > maxNumeroBoleta) maxNumeroBoleta = num;
      }

      const matchNC = sede.serieNotaCredito?.match(/NC(\d+)/);
      if (matchNC) {
        const num = parseInt(matchNC[1], 10);
        if (num > maxNumeroNC) maxNumeroNC = num;
      }

      const matchND = sede.serieNotaDebito?.match(/ND(\d+)/);
      if (matchND) {
        const num = parseInt(matchND[1], 10);
        if (num > maxNumeroND) maxNumeroND = num;
      }

      const matchGR = sede.serieGuiaRemision?.match(/GR(\d+)/);
      if (matchGR) {
        const num = parseInt(matchGR[1], 10);
        if (num > maxNumeroGR) maxNumeroGR = num;
      }
    }

    // Generar las siguientes series disponibles
    const siguienteFactura = maxNumeroFactura + 1;
    const siguienteBoleta = maxNumeroBoleta + 1;
    const siguienteNC = maxNumeroNC + 1;
    const siguienteND = maxNumeroND + 1;
    const siguienteGR = maxNumeroGR + 1;

    // Generar series automáticamente basadas en los máximos encontrados
    return {
      serieFactura: data.serieFactura || `F${String(siguienteFactura).padStart(3, '0')}`,
      serieBoleta: data.serieBoleta || `B${String(siguienteBoleta).padStart(3, '0')}`,
      serieNotaCredito:
        data.serieNotaCredito || `NC${String(siguienteNC).padStart(2, '0')}`,
      serieNotaDebito: data.serieNotaDebito || `ND${String(siguienteND).padStart(2, '0')}`,
      serieGuiaRemision:
        data.serieGuiaRemision || `GR${String(siguienteGR).padStart(2, '0')}`,
    };
  }

  /**
   * Validar que las series de comprobantes sean únicas en la empresa
   */
  private async validarSeriesUnicas(
    empresaId: string,
    series: {
      serieFactura: string;
      serieBoleta: string;
      serieNotaCredito: string;
      serieNotaDebito: string;
      serieGuiaRemision: string;
    },
    excludeSedeId?: string,
  ): Promise<void> {
    const whereCondition = {
      empresaId,
      deletedAt: null,
      ...(excludeSedeId && { id: { not: excludeSedeId } }),
    };

    // Verificar cada serie
    const seriesAVerificar = [
      { campo: 'serieFactura', valor: series.serieFactura, nombre: 'Factura' },
      { campo: 'serieBoleta', valor: series.serieBoleta, nombre: 'Boleta' },
      { campo: 'serieNotaCredito', valor: series.serieNotaCredito, nombre: 'Nota de Crédito' },
      { campo: 'serieNotaDebito', valor: series.serieNotaDebito, nombre: 'Nota de Débito' },
      {
        campo: 'serieGuiaRemision',
        valor: series.serieGuiaRemision,
        nombre: 'Guía de Remisión',
      },
    ];

    for (const serie of seriesAVerificar) {
      const sedeConSerie = await this.prisma.sede.findFirst({
        where: {
          ...whereCondition,
          [serie.campo]: serie.valor,
        },
      });

      if (sedeConSerie) {
        throw new ConflictException(
          `La serie "${serie.valor}" para ${serie.nombre} ya está siendo usada por la sede "${sedeConSerie.nombre}"`,
        );
      }
    }
  }

  /**
   * Formatear respuesta de sede con detalles
   */
  private formatSedeDetail(sede: any): SedeDetailDto {
    return {
      id: sede.id,
      empresaId: sede.empresaId,
      codigo: sede.codigo,
      nombre: sede.nombre,
      telefono: sede.telefono,
      email: sede.email,
      tipoSede: sede.tipoSede,
      direccion: sede.direccion,
      referencia: sede.referencia,
      distrito: sede.distrito,
      provincia: sede.provincia,
      departamento: sede.departamento,
      pais: sede.pais,
      coordenadas: sede.coordenadas,
      horarioAtencion: sede.horarioAtencion,
      configuracion: sede.configuracion,
      serieFactura: sede.serieFactura,
      serieBoleta: sede.serieBoleta,
      serieNotaCredito: sede.serieNotaCredito,
      serieNotaDebito: sede.serieNotaDebito,
      serieGuiaRemision: sede.serieGuiaRemision,
      // Facturación electrónica por sede
      rucSede: sede.rucSede,
      razonSocialSede: sede.razonSocialSede,
      direccionFiscalSede: sede.direccionFiscalSede,
      proveedorRuta: sede.proveedorRuta,
      proveedorToken: sede.proveedorToken,
      facturacionActiva: sede.facturacionActiva,
      resolucionSunat: sede.resolucionSunat,
      ultimoNumeroFactura: sede.ultimoNumeroFactura,
      ultimoNumeroBoleta: sede.ultimoNumeroBoleta,
      ultimoNumeroNotaCredito: sede.ultimoNumeroNotaCredito,
      ultimoNumeroNotaDebito: sede.ultimoNumeroNotaDebito,
      ultimoNumeroGuiaRemision: sede.ultimoNumeroGuiaRemision,
      isActive: sede.isActive,
      deletedAt: sede.deletedAt,
      esPrincipal: sede.esPrincipal,
      creadoEn: sede.creadoEn,
      actualizadoEn: sede.actualizadoEn,
      userRole: sede.usuarios && sede.usuarios.length > 0 ? sede.usuarios[0].rol : undefined,
      totalUsuarios: sede._count?.usuarios,
      totalProductos: sede._count?.productos,
      totalServicios: sede._count?.servicios,
    };
  }
}
