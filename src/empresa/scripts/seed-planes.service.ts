import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PeriodoSuscripcion } from '@prisma/client';

@Injectable()
export class SeedPlanesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedPlanes();
  }

  async seedPlanes() {
    console.log('📦 Creando planes de suscripción...');

    const planes = [
      {
        nombre: 'BÁSICO',
        descripcion: 'Perfecto para pequeñas empresas y emprendedores',
        precio: 0.00,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: 50,
        limiteServicios: 20,
        limiteUsuarios: 3,
        limiteSedes: 1,
        tienePersonalizacion: false,
        tieneDominioPropio: false,
        tieneApi: false,
        tieneReportesAvanzados: false,
        caracteristicas: {
          productos: 50,
          servicios: 20,
          usuarios: 3,
          sedes: 1,
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'basicos',
          soporte: 'email'
        }
      },
      {
        nombre: 'PROFESIONAL',
        descripcion: 'Ideal para empresas en crecimiento',
        precio: 99.90,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: 500,
        limiteServicios: 100,
        limiteUsuarios: 10,
        limiteSedes: 3,
        tienePersonalizacion: true,
        tieneDominioPropio: false,
        tieneApi: false,
        tieneReportesAvanzados: true,
        caracteristicas: {
          productos: 500,
          servicios: 100,
          usuarios: 10,
          sedes: 3,
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'avanzados',
          soporte: 'email_telefono',
          personalizacion: true
        }
      },
      {
        nombre: 'EMPRESARIAL',
        descripcion: 'Solución completa para grandes empresas',
        precio: 299.90,
        periodo: 'MENSUAL' as PeriodoSuscripcion,
        limiteProductos: null, // Ilimitado
        limiteServicios: null, // Ilimitado
        limiteUsuarios: 50,
        limiteSedes: 10,
        tienePersonalizacion: true,
        tieneDominioPropio: true,
        tieneApi: true,
        tieneReportesAvanzados: true,
        caracteristicas: {
          productos: 'ilimitado',
          servicios: 'ilimitado',
          usuarios: 50,
          sedes: 10,
          facturacion: true,
          inventario: true,
          clientes: true,
          reportes: 'avanzados_personalizados',
          soporte: '24/7',
          personalizacion: true,
          api: true,
          dominio_propio: true
        }
      }
    ];

    for (const plan of planes) {
      try {
        const existingPlan = await this.prisma.planSuscripcion.findUnique({
          where: { nombre: plan.nombre }
        });

        if (!existingPlan) {
          await this.prisma.planSuscripcion.create({
            data: plan
          });
          console.log(`✅ Plan "${plan.nombre}" creado exitosamente`);
        } else {
          console.log(`⚠️  Plan "${plan.nombre}" ya existe`);
        }
      } catch (error) {
        console.error(`❌ Error creando plan "${plan.nombre}":`, error);
      }
    }

    console.log('🎉 Planes de suscripción creados exitosamente');
  }
}