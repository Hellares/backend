import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../logger/logger.service';

/**
 * Helper para resolver automáticamente el contexto de sede
 *
 * Lógica:
 * 1. Si se proporciona sedeId → validar acceso del usuario
 * 2. Si NO se proporciona sedeId:
 *    - Si el usuario tiene UNA sola sede activa → auto-asignar
 *    - Si tiene MÚLTIPLES sedes → requerir selección explícita
 */
@Injectable()
export class SedeContextHelper {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(SedeContextHelper.name);
  }

  /**
   * Resolver el sedeId automáticamente o validar el proporcionado
   *
   * @param empresaId - ID de la empresa
   * @param userId - ID del usuario
   * @param sedeIdPropuesto - sedeId proporcionado (opcional)
   * @returns sedeId válido para usar
   */
  async resolveSedeId(
    empresaId: string,
    userId: string,
    sedeIdPropuesto?: string,
  ): Promise<string> {
    // Caso 1: Se proporcionó sedeId → validar acceso
    if (sedeIdPropuesto) {
      this.logger.debug('Validating provided sedeId', {
        empresaId,
        userId,
        sedeIdPropuesto,
      });

      await this.validateSedeAccess(empresaId, userId, sedeIdPropuesto);
      return sedeIdPropuesto;
    }

    // Caso 2: NO se proporcionó sedeId → auto-resolver
    this.logger.debug('Auto-resolving sedeId', { empresaId, userId });

    const sedesUsuario = await this.getSedesUsuario(empresaId, userId);

    if (sedesUsuario.length === 0) {
      this.logger.warn('User has no assigned sedes', { empresaId, userId });
      throw new ForbiddenException(
        'No tienes sedes asignadas en esta empresa. Contacta al administrador.',
      );
    }

    if (sedesUsuario.length === 1) {
      // Auto-asignar única sede
      const sedeId = sedesUsuario[0].id;
      this.logger.debug('Auto-assigned single sede', {
        empresaId,
        userId,
        sedeId,
        sedeName: sedesUsuario[0].nombre,
      });
      return sedeId;
    }

    // Múltiples sedes → requiere selección explícita
    this.logger.warn('Multiple sedes found, explicit selection required', {
      empresaId,
      userId,
      sedesCount: sedesUsuario.length,
    });

    throw new BadRequestException(
      `Tienes acceso a ${sedesUsuario.length} sedes. Debes especificar en cuál sede deseas realizar esta operación.`,
    );
  }

  /**
   * Obtener sedes activas del usuario en una empresa
   */
  async getSedesUsuario(empresaId: string, userId: string) {
    // Primero verificar si el usuario es admin de la empresa
    const isEmpresaAdmin = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: {
          in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'],
        },
      },
    });

    // Si es admin de empresa, tiene acceso a todas las sedes
    if (isEmpresaAdmin) {
      return this.prisma.sede.findMany({
        where: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          nombre: true,
          codigo: true,
          tipoSede: true,
          esPrincipal: true,
        },
        orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }],
      });
    }

    // Si no es admin, obtener solo sedes asignadas específicamente
    const usuarioSedeRoles = await this.prisma.usuarioSedeRol.findMany({
      where: {
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        sede: {
          empresaId,
          isActive: true,
          deletedAt: null,
        },
      },
      include: {
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
            tipoSede: true,
            esPrincipal: true,
          },
        },
      },
      orderBy: [{ sede: { esPrincipal: 'desc' } }, { sede: { nombre: 'asc' } }],
    });

    return usuarioSedeRoles.map((usr) => usr.sede);
  }

  /**
   * Validar que el usuario tenga acceso a una sede específica
   */
  private async validateSedeAccess(
    empresaId: string,
    userId: string,
    sedeId: string,
  ): Promise<void> {
    // Verificar que la sede exista y pertenezca a la empresa
    const sede = await this.prisma.sede.findFirst({
      where: {
        id: sedeId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!sede) {
      this.logger.warn('Sede not found or not active', {
        sedeId,
        empresaId,
        userId,
      });
      throw new BadRequestException('La sede especificada no existe o no está activa.');
    }

    // Verificar acceso del usuario
    const hasAccess = await this.hasSedeAccess(userId, empresaId, sedeId);

    if (!hasAccess) {
      this.logger.warn('User does not have access to sede', {
        sedeId,
        empresaId,
        userId,
      });
      throw new ForbiddenException('No tienes acceso a esta sede.');
    }

    this.logger.debug('Sede access validated successfully', {
      sedeId,
      empresaId,
      userId,
    });
  }

  /**
   * Verificar si el usuario tiene acceso a una sede
   */
  private async hasSedeAccess(
    userId: string,
    empresaId: string,
    sedeId: string,
  ): Promise<boolean> {
    // Caso 1: Es admin de la empresa → acceso a todas las sedes
    const isEmpresaAdmin = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: {
          in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'],
        },
      },
    });

    if (isEmpresaAdmin) {
      return true;
    }

    // Caso 2: Tiene asignación específica a esta sede
    const sedeAssignment = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId: userId,
        sedeId,
        isActive: true,
        deletedAt: null,
      },
    });

    return !!sedeAssignment;
  }

  /**
   * Validar operación según el tipo de sede
   *
   * @param sedeId - ID de la sede
   * @param operacion - Tipo de operación (VENTA, TRANSFERENCIA, etc.)
   */
  async validateOperacionPorTipoSede(
    sedeId: string,
    operacion: 'VENTA' | 'TRANSFERENCIA_ENVIO' | 'TRANSFERENCIA_RECEPCION' | 'AJUSTE_INVENTARIO',
  ): Promise<void> {
    const sede = await this.prisma.sede.findUnique({
      where: { id: sedeId },
      select: { tipoSede: true, nombre: true, codigo: true },
    });

    if (!sede) {
      throw new BadRequestException('Sede no encontrada');
    }

    // Validaciones por tipo de sede
    switch (sede.tipoSede) {
      case 'SOLO_ALMACEN':
        if (operacion === 'VENTA') {
          throw new BadRequestException(
            `La sede "${sede.nombre}" (${sede.codigo}) es de tipo ALMACÉN y no puede realizar ventas directas. Solo puede enviar/recibir transferencias.`,
          );
        }
        break;

      case 'PUNTO_VENTA':
        if (operacion === 'TRANSFERENCIA_ENVIO') {
          throw new BadRequestException(
            `La sede "${sede.nombre}" (${sede.codigo}) es un PUNTO DE VENTA y no puede enviar transferencias (no tiene almacén propio).`,
          );
        }
        break;

      case 'OFICINA_ADMINISTRATIVA':
        if (operacion === 'VENTA' || operacion === 'TRANSFERENCIA_ENVIO' || operacion === 'TRANSFERENCIA_RECEPCION') {
          throw new BadRequestException(
            `La sede "${sede.nombre}" (${sede.codigo}) es ADMINISTRATIVA y no puede realizar operaciones comerciales.`,
          );
        }
        break;

      case 'OPERATIVA_COMPLETA':
        // Puede hacer todo
        break;
    }

    this.logger.debug('Operation validated for sede type', {
      sedeId,
      tipoSede: sede.tipoSede,
      operacion,
    });
  }
}
