/**
 * Script de uso único para generar avisos de mantenimiento
 * para todas las órdenes completadas existentes.
 *
 * Uso: npx ts-node scripts/generar-avisos-mantenimiento.ts
 */
import { PrismaClient, EstadoOrdenServicio, EstadoAviso } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const INTERVALOS_DEFAULT: Record<string, number> = {
  MANTENIMIENTO: 120,
  REPARACION: 180,
  LIMPIEZA: 90,
  INSTALACION: 365,
  ACTUALIZACION: 180,
};

async function main() {
  console.log('Generando avisos de mantenimiento para órdenes completadas...\n');

  // Obtener todas las empresas
  const empresas = await prisma.empresa.findMany({ select: { id: true, nombre: true } });
  let totalGlobal = 0;

  for (const empresa of empresas) {
    // Obtener o crear configuración
    let config = await prisma.configuracionAvisoMantenimiento.findUnique({
      where: { empresaId: empresa.id },
    });

    if (!config) {
      config = await prisma.configuracionAvisoMantenimiento.create({
        data: {
          empresaId: empresa.id,
          intervalos: INTERVALOS_DEFAULT,
          diasAnticipacion: 7,
          habilitado: true,
        },
      });
      console.log(`  Configuración creada para "${empresa.nombre}" con intervalos por defecto`);
    }

    const intervalos = config.intervalos as Record<string, number>;

    // Buscar órdenes completadas sin aviso activo
    const ordenes = await prisma.ordenServicio.findMany({
      where: {
        empresaId: empresa.id,
        estado: {
          in: [EstadoOrdenServicio.ENTREGADO, EstadoOrdenServicio.FINALIZADO],
        },
        fechaEntrega: { not: null },
        avisosMantenimiento: {
          none: {
            estado: { in: [EstadoAviso.PENDIENTE, EstadoAviso.NOTIFICADO] },
          },
        },
      },
      select: {
        id: true,
        codigo: true,
        empresaId: true,
        clienteId: true,
        tipoServicio: true,
        tipoEquipo: true,
        marcaEquipo: true,
        fechaEntrega: true,
        actualizadoEn: true,
      },
    });

    let creados = 0;

    for (const orden of ordenes) {
      const dias = intervalos[orden.tipoServicio];
      if (!dias) continue;

      const fechaBase = orden.fechaEntrega ?? orden.actualizadoEn;
      const fechaRecomendada = new Date(fechaBase.getTime() + dias * 24 * 60 * 60 * 1000);
      const equipoParts = [orden.tipoEquipo, orden.marcaEquipo].filter(Boolean);

      await prisma.avisoMantenimiento.create({
        data: {
          empresaId: orden.empresaId,
          ordenServicioId: orden.id,
          clienteId: orden.clienteId,
          tipoServicio: orden.tipoServicio,
          equipoDescripcion: equipoParts.length > 0 ? equipoParts.join(' - ') : null,
          fechaUltimoServicio: fechaBase,
          fechaRecomendada,
        },
      });

      creados++;
      console.log(`    [${orden.codigo}] ${orden.tipoServicio} → Aviso para ${fechaRecomendada.toLocaleDateString()}`);
    }

    if (creados > 0) {
      console.log(`  ✓ "${empresa.nombre}": ${creados} aviso(s) creados de ${ordenes.length} órdenes evaluadas\n`);
    } else {
      console.log(`  - "${empresa.nombre}": sin avisos nuevos (${ordenes.length} órdenes evaluadas)\n`);
    }
    totalGlobal += creados;
  }

  // Marcar como NOTIFICADO los que ya vencieron
  const now = new Date();
  const notificados = await prisma.avisoMantenimiento.updateMany({
    where: {
      estado: EstadoAviso.PENDIENTE,
      fechaRecomendada: { lte: now },
    },
    data: {
      estado: EstadoAviso.NOTIFICADO,
      notificadoEn: now,
    },
  });

  console.log(`Total: ${totalGlobal} aviso(s) generados`);
  if (notificados.count > 0) {
    console.log(`${notificados.count} aviso(s) marcados como NOTIFICADO (ya vencidos)`);
  }
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
