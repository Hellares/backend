import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PeriodoSuscripcion } from '@prisma/client';

@Injectable()
export class SeedPlanesService /* implements OnModuleInit */ {
  constructor(private readonly prisma: PrismaService) {}

  // async onModuleInit() {
  //   await this.seedPlanes();
  // }

  async seedPlanes() {
    console.log('📦 Actualizando planes de suscripción...');

    const planes = [
      {
        nombre: 'BÁSICO',
        descripcion: 'Capa gratuita para comenzar tu negocio digital',
        precio: 0.00,
        precioSemestral: null,
        precioAnual: null,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: 50,
        limiteServicios: 20,
        limiteUsuarios: 3,
        limiteSedes: 1,
        limitePlantillasAtributos: 3,
        limiteCotizaciones: 20,
        limiteAlmacenamientoMB: 200,
        tieneWebPermanente: false,
        tienePersonalizacion: false,
        tieneDominioPropio: false,
        tieneApi: false,
        tieneReportesAvanzados: false,
        caracteristicas: {
          productos: 50,
          servicios: 20,
          usuarios: 3,
          sedes: 1,
          plantillas: 3,
          cotizaciones: 20,
          almacenamiento: '200MB',
          paginaWeb: 'trial_2_meses',
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'basicos',
          soporte: 'email',
        },
      },
      {
        nombre: 'EMPRENDEDOR',
        descripcion: 'Para negocios en crecimiento que necesitan mas alcance',
        precio: 30.00,
        precioSemestral: 160.00,
        precioAnual: 300.00,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: 1000,
        limiteServicios: 100,
        limiteUsuarios: 10,
        limiteSedes: 3,
        limitePlantillasAtributos: 10,
        limiteCotizaciones: 100,
        limiteAlmacenamientoMB: 3072, // 3GB
        tieneWebPermanente: true,
        tienePersonalizacion: true,
        tieneDominioPropio: false,
        tieneApi: false,
        tieneReportesAvanzados: false,
        caracteristicas: {
          productos: 1000,
          servicios: 100,
          usuarios: 10,
          sedes: 3,
          plantillas: 10,
          cotizaciones: 100,
          almacenamiento: '3GB',
          paginaWeb: 'permanente',
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'basicos',
          soporte: 'email',
          personalizacion: true,
        },
      },
      {
        nombre: 'PROFESIONAL',
        descripcion: 'Ideal para empresas consolidadas con operacion avanzada',
        precio: 50.00,
        precioSemestral: 250.00,
        precioAnual: 500.00,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: 2000,
        limiteServicios: 300,
        limiteUsuarios: 50,
        limiteSedes: 10,
        limitePlantillasAtributos: 30,
        limiteCotizaciones: 500,
        limiteAlmacenamientoMB: 5120, // 5GB
        tieneWebPermanente: true,
        tienePersonalizacion: true,
        tieneDominioPropio: false,
        tieneApi: false,
        tieneReportesAvanzados: true,
        caracteristicas: {
          productos: 2000,
          servicios: 300,
          usuarios: 50,
          sedes: 10,
          plantillas: 30,
          cotizaciones: 500,
          almacenamiento: '5GB',
          paginaWeb: 'permanente',
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'avanzados',
          soporte: 'email_telefono',
          personalizacion: true,
        },
      },
      {
        nombre: 'EMPRESARIAL',
        descripcion: 'Solucion completa para grandes empresas sin limites',
        precio: 100.00,
        precioSemestral: 500.00,
        precioAnual: 1000.00,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: null, // Ilimitado
        limiteServicios: null, // Ilimitado
        limiteUsuarios: 100,
        limiteSedes: 20,
        limitePlantillasAtributos: null, // Ilimitado
        limiteCotizaciones: null, // Ilimitado
        limiteAlmacenamientoMB: 10240, // 10GB
        tieneWebPermanente: true,
        tienePersonalizacion: true,
        tieneDominioPropio: true,
        tieneApi: true,
        tieneReportesAvanzados: true,
        caracteristicas: {
          productos: 'ilimitado',
          servicios: 'ilimitado',
          usuarios: 100,
          sedes: 20,
          plantillas: 'ilimitado',
          cotizaciones: 'ilimitado',
          almacenamiento: '10GB',
          paginaWeb: 'permanente',
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'avanzados_personalizados',
          soporte: '24/7',
          personalizacion: true,
          api: true,
          dominio_propio: true,
        },
      },
    ];

    for (const plan of planes) {
      try {
        const existingPlan = await this.prisma.planSuscripcion.findUnique({
          where: { nombre: plan.nombre },
        });

        if (!existingPlan) {
          await this.prisma.planSuscripcion.create({ data: plan });
          console.log(`✅ Plan "${plan.nombre}" creado`);
        } else {
          await this.prisma.planSuscripcion.update({
            where: { nombre: plan.nombre },
            data: plan,
          });
          console.log(`🔄 Plan "${plan.nombre}" actualizado`);
        }
      } catch (error) {
        console.error(`❌ Error con plan "${plan.nombre}":`, error);
      }
    }

    console.log('🎉 Planes de suscripción listos');
  }
}
