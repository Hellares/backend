import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlanLimitsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Verifica si la empresa puede crear más plantillas de atributos
   * según el límite de su plan de suscripción
   */
  async checkPlantillasAtributosLimit(empresaId: string): Promise<void> {
    // Obtener empresa con su plan
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            limitePlantillasAtributos: true,
            nombre: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      throw new ForbiddenException(
        'La empresa no tiene un plan de suscripción activo',
      );
    }

    const limite = empresa.planSuscripcion.limitePlantillasAtributos;

    // Si el límite es null o undefined, significa ilimitado
    if (limite === null || limite === undefined) {
      return;
    }

    // Contar plantillas PERSONALIZADAS actuales (no las predefinidas)
    const plantillasActuales = await this.prisma.productoAtributoPlantilla.count({
      where: {
        empresaId,
        esPredefinida: false, // Solo contar las personalizadas
        isActive: true,
      },
    });

    if (plantillasActuales >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limite} plantilla(s) de atributos para el plan ${empresa.planSuscripcion.nombre}. ` +
        `Actualiza tu plan para crear más plantillas personalizadas.`,
      );
    }
  }

  /**
   * Verifica si la empresa puede crear más productos
   */
  async checkProductosLimit(empresaId: string): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            limiteProductos: true,
            nombre: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      throw new ForbiddenException(
        'La empresa no tiene un plan de suscripción activo',
      );
    }

    const limite = empresa.planSuscripcion.limiteProductos;

    if (limite === null || limite === undefined) {
      return;
    }

    const productosActuales = await this.prisma.producto.count({
      where: {
        empresaId,
        deletedAt: null,
      },
    });

    if (productosActuales >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limite} producto(s) para el plan ${empresa.planSuscripcion.nombre}. ` +
        `Actualiza tu plan para crear más productos.`,
      );
    }
  }

  /**
   * Verifica si la empresa puede crear más usuarios
   */
  async checkUsuariosLimit(empresaId: string): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            limiteUsuarios: true,
            nombre: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      throw new ForbiddenException(
        'La empresa no tiene un plan de suscripción activo',
      );
    }

    const limite = empresa.planSuscripcion.limiteUsuarios;

    if (limite === null || limite === undefined) {
      return;
    }

    const usuariosActuales = await this.prisma.empresaUsuarioRol.count({
      where: {
        empresaId,
        isActive: true,
      },
    });

    if (usuariosActuales >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limite} usuario(s) para el plan ${empresa.planSuscripcion.nombre}. ` +
        `Actualiza tu plan para agregar más usuarios.`,
      );
    }
  }

  /**
   * Verifica si la empresa puede crear más cotizaciones
   */
  async checkCotizacionesLimit(empresaId: string): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            limiteCotizaciones: true,
            nombre: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      throw new ForbiddenException(
        'La empresa no tiene un plan de suscripción activo',
      );
    }

    const limite = empresa.planSuscripcion.limiteCotizaciones;

    if (limite === null || limite === undefined) {
      return;
    }

    const cotizacionesActuales = await this.prisma.cotizacion.count({
      where: {
        empresaId,
      },
    });

    if (cotizacionesActuales >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limite} cotización(es) para el plan ${empresa.planSuscripcion.nombre}. ` +
        `Actualiza tu plan para crear más cotizaciones.`,
      );
    }
  }

  /**
   * Verifica si la empresa puede crear más servicios
   */
  async checkServiciosLimit(empresaId: string): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            limiteServicios: true,
            nombre: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      throw new ForbiddenException(
        'La empresa no tiene un plan de suscripción activo',
      );
    }

    const limite = empresa.planSuscripcion.limiteServicios;

    if (limite === null || limite === undefined) {
      return;
    }

    const serviciosActuales = await this.prisma.servicio.count({
      where: {
        empresaId,
        isActive: true,
      },
    });

    if (serviciosActuales >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limite} servicio(s) para el plan ${empresa.planSuscripcion.nombre}. ` +
        `Actualiza tu plan para crear más servicios.`,
      );
    }
  }

  /**
   * Obtiene información de límites y uso actual del plan
   */
  async getPlanLimitsInfo(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            nombre: true,
            limiteProductos: true,
            limiteServicios: true,
            limiteUsuarios: true,
            limiteSedes: true,
            limitePlantillasAtributos: true,
            limiteCotizaciones: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      return null;
    }

    // Obtener uso actual
    const [
      productosActuales,
      serviciosActuales,
      usuariosActuales,
      sedesActuales,
      plantillasActuales,
      cotizacionesActuales,
    ] = await Promise.all([
      this.prisma.producto.count({
        where: { empresaId, deletedAt: null },
      }),
      this.prisma.servicio.count({
        where: { empresaId, isActive: true },
      }),
      this.prisma.empresaUsuarioRol.count({
        where: { empresaId, isActive: true },
      }),
      this.prisma.sede.count({
        where: { empresaId, isActive: true },
      }),
      this.prisma.productoAtributoPlantilla.count({
        where: { empresaId, esPredefinida: false, isActive: true },
      }),
      this.prisma.cotizacion.count({
        where: { empresaId },
      }),
    ]);

    return {
      plan: empresa.planSuscripcion.nombre,
      limites: {
        productos: {
          limite: empresa.planSuscripcion.limiteProductos,
          actual: productosActuales,
          disponible:
            empresa.planSuscripcion.limiteProductos !== null
              ? empresa.planSuscripcion.limiteProductos - productosActuales
              : null,
        },
        servicios: {
          limite: empresa.planSuscripcion.limiteServicios,
          actual: serviciosActuales,
          disponible:
            empresa.planSuscripcion.limiteServicios !== null
              ? empresa.planSuscripcion.limiteServicios - serviciosActuales
              : null,
        },
        usuarios: {
          limite: empresa.planSuscripcion.limiteUsuarios,
          actual: usuariosActuales,
          disponible:
            empresa.planSuscripcion.limiteUsuarios !== null
              ? empresa.planSuscripcion.limiteUsuarios - usuariosActuales
              : null,
        },
        sedes: {
          limite: empresa.planSuscripcion.limiteSedes,
          actual: sedesActuales,
          disponible:
            empresa.planSuscripcion.limiteSedes !== null
              ? empresa.planSuscripcion.limiteSedes - sedesActuales
              : null,
        },
        plantillasAtributos: {
          limite: empresa.planSuscripcion.limitePlantillasAtributos,
          actual: plantillasActuales,
          disponible:
            empresa.planSuscripcion.limitePlantillasAtributos !== null
              ? empresa.planSuscripcion.limitePlantillasAtributos -
                plantillasActuales
              : null,
        },
        cotizaciones: {
          limite: empresa.planSuscripcion.limiteCotizaciones,
          actual: cotizacionesActuales,
          disponible:
            empresa.planSuscripcion.limiteCotizaciones !== null
              ? empresa.planSuscripcion.limiteCotizaciones -
                cotizacionesActuales
              : null,
        },
      },
    };
  }
}
