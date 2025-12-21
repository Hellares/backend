import { PrismaClient } from '@prisma/client';
import { PeriodoSuscripcion } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function seedPlanesSuscripcion() {
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
      limitePlantillasAtributos: 5, // ✨ Límite de plantillas de atributos
      tienePersonalizacion: false,
      tieneDominioPropio: false,
      tieneApi: false,
      tieneReportesAvanzados: false,
      caracteristicas: {
        productos: 50,
        servicios: 20,
        usuarios: 3,
        sedes: 1,
        plantillasAtributos: 5,
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
      limitePlantillasAtributos: 15, // ✨ Límite de plantillas de atributos
      tienePersonalizacion: true,
      tieneDominioPropio: false,
      tieneApi: false,
      tieneReportesAvanzados: true,
      caracteristicas: {
        productos: 500,
        servicios: 100,
        usuarios: 10,
        sedes: 3,
        plantillasAtributos: 15,
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
      limitePlantillasAtributos: null, // ✨ Ilimitado
      tienePersonalizacion: true,
      tieneDominioPropio: true,
      tieneApi: true,
      tieneReportesAvanzados: true,
      caracteristicas: {
        productos: 'ilimitado',
        servicios: 'ilimitado',
        usuarios: 50,
        sedes: 10,
        plantillasAtributos: 'ilimitado',
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
      await prisma.planSuscripcion.upsert({
        where: { nombre: plan.nombre },
        update: {
          descripcion: plan.descripcion,
          precio: plan.precio,
          periodo: plan.periodo,
          limiteProductos: plan.limiteProductos,
          limiteServicios: plan.limiteServicios,
          limiteUsuarios: plan.limiteUsuarios,
          limiteSedes: plan.limiteSedes,
          limitePlantillasAtributos: plan.limitePlantillasAtributos,
          tienePersonalizacion: plan.tienePersonalizacion,
          tieneDominioPropio: plan.tieneDominioPropio,
          tieneApi: plan.tieneApi,
          tieneReportesAvanzados: plan.tieneReportesAvanzados,
          caracteristicas: plan.caracteristicas,
        },
        create: plan
      });
      console.log(`✅ Plan "${plan.nombre}" creado/actualizado exitosamente`);
    } catch (error) {
      console.error(`❌ Error procesando plan "${plan.nombre}":`, error);
    }
  }

  console.log('🎉 Planes de suscripción creados exitosamente');
}

// Para ejecutar manualmente si es necesario
seedPlanesSuscripcion()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });