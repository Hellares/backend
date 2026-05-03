import { PrismaClient } from '@prisma/client';
import { PeriodoSuscripcion } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function seedPlanesSuscripcion() {
  console.log('📦 Sembrando planes de suscripción...');

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
      limiteAlmacenamientoMB: 100,
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
        almacenamiento: '100MB',
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
      limiteAlmacenamientoMB: 1024,
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
        almacenamiento: '1GB',
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
      limiteAlmacenamientoMB: 3072,
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
        almacenamiento: '3GB',
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
      limiteProductos: null,
      limiteServicios: null,
      limiteUsuarios: 100,
      limiteSedes: 20,
      limitePlantillasAtributos: null,
      limiteCotizaciones: null,
      limiteAlmacenamientoMB: 5120,
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
        almacenamiento: '5GB',
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
      await prisma.planSuscripcion.upsert({
        where: { nombre: plan.nombre },
        update: plan,
        create: plan,
      });
      console.log(`✅ Plan "${plan.nombre}" creado/actualizado`);
    } catch (error) {
      console.error(`❌ Error procesando plan "${plan.nombre}":`, error);
    }
  }

  console.log('🎉 Planes sembrados exitosamente');
}

seedPlanesSuscripcion()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
