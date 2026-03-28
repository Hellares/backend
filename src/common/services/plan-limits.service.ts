import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Rol } from '@prisma/client';

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
        rol: { not: Rol.CLIENTE },
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
   * Verifica si la empresa puede crear más campos de configuración de servicio
   */
  async checkConfiguracionCamposLimit(empresaId: string): Promise<void> {
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

    if (limite === null || limite === undefined) {
      return;
    }

    const camposActuales = await this.prisma.configuracionCamposServicio.count({
      where: {
        empresaId,
        isActive: true,
      },
    });

    if (camposActuales >= limite) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${limite} campo(s) de configuración para el plan ${empresa.planSuscripcion.nombre}. ` +
        `Actualiza tu plan para crear más campos personalizados.`,
      );
    }
  }

  /**
   * Obtiene información de límites y uso actual del plan
   */
  /**
   * Verifica si la empresa puede subir más archivos según su límite de almacenamiento
   */
  async checkStorageLimit(empresaId: string, newFileSizeBytes: number): Promise<void> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: {
            limiteAlmacenamientoMB: true,
            nombre: true,
          },
        },
      },
    });

    if (!empresa || !empresa.planSuscripcion) {
      throw new ForbiddenException('La empresa no tiene un plan de suscripción activo');
    }

    const limiteMB = empresa.planSuscripcion.limiteAlmacenamientoMB;
    if (limiteMB === null || limiteMB === undefined) return;

    const result = await this.prisma.archivo.aggregate({
      where: { empresaId, isActive: true, deletedAt: null },
      _sum: { tamanoBytes: true },
    });

    const usadoBytes = result._sum.tamanoBytes || 0;
    const limiteBytes = limiteMB * 1024 * 1024;
    const usadoMB = Math.round(Number(usadoBytes) / (1024 * 1024));

    if (Number(usadoBytes) + newFileSizeBytes > limiteBytes) {
      throw new ForbiddenException(
        `Has alcanzado el límite de almacenamiento de ${limiteMB >= 1024 ? (limiteMB / 1024) + 'GB' : limiteMB + 'MB'} ` +
        `para el plan ${empresa.planSuscripcion.nombre} (usado: ${usadoMB}MB). ` +
        `Actualiza tu plan para subir más archivos.`,
      );
    }
  }

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
            limiteAlmacenamientoMB: true,
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
      storageResult,
    ] = await Promise.all([
      this.prisma.producto.count({
        where: { empresaId, deletedAt: null },
      }),
      this.prisma.servicio.count({
        where: { empresaId, isActive: true },
      }),
      this.prisma.empresaUsuarioRol.count({
        where: { empresaId, isActive: true, rol: { not: Rol.CLIENTE } },
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
      this.prisma.archivo.aggregate({
        where: { empresaId, isActive: true, deletedAt: null },
        _sum: { tamanoBytes: true },
      }),
    ]);

    const almacenamientoUsadoMB = Math.round(
      Number(storageResult._sum.tamanoBytes || 0) / (1024 * 1024),
    );

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
        almacenamiento: {
          limiteMB: empresa.planSuscripcion.limiteAlmacenamientoMB,
          actualMB: almacenamientoUsadoMB,
          disponibleMB:
            empresa.planSuscripcion.limiteAlmacenamientoMB !== null
              ? empresa.planSuscripcion.limiteAlmacenamientoMB - almacenamientoUsadoMB
              : null,
        },
      },
    };
  }
}
