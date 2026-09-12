import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

/**
 * CONCILIACIÓN DE LOTES — se corre UNA vez, antes de encender
 * `LOTES_FEFO_ENABLED=true`.
 *
 * ## Por qué hace falta
 *
 * `consumirLotesFIFO` existía y no la llamaba nadie, así que `cantidadActual`
 * de los lotes NUNCA bajó al vender: hoy el 100% de los lotes de prod está en
 * `cantidadActual = cantidadInicial`. Si se enciende el motor sin arreglar
 * eso, el consumo FEFO repartiría mercadería que ya se vendió.
 *
 * ## Qué hace
 *
 * Deja valer, para cada `ProductoStock`, la invariante:
 *
 *     Σ cantidadActual de sus lotes PRESENTES (ACTIVO + VENCIDO) = stockActual
 *
 * - **Lotes de MÁS** → descuenta el excedente en orden FEFO (lo que vence
 *   antes primero; entre los eternos, el más viejo). Son las ventas pasadas
 *   que nunca se descontaron.
 * - **Lotes de MENOS** → crea un LOTE DE APERTURA por la diferencia, al costo
 *   promedio del producto. Es el stock que entró por ajuste o carga masiva,
 *   antes de que existiera el control por lote.
 *
 * 🔴 El lote de apertura se crea con `fechaIngreso` ANTERIOR a la de todos los
 * lotes reales del producto. No es cosmético: si quedara como el más reciente,
 * ROMPERÍA "vender a costo", que lee el último lote para cobrar el costo de la
 * última factura — pasaría a cobrar el promedio. Backdateado, el lote de la
 * compra real sigue siendo el más reciente y el feature sigue intacto.
 *
 * 🔑 NO toca `stockActual` ni `precioCosto`. El stock y el costeo son la
 * verdad; los lotes son los que se acomodan a ellos.
 *
 * ## Uso
 *
 *     npx ts-node scripts/conciliar-lotes.ts            # simulacro (no escribe)
 *     npx ts-node scripts/conciliar-lotes.ts --aplicar  # escribe
 */

type Resumen = {
  productoStockId: string;
  nombre: string;
  sede: string;
  stockActual: number;
  sumaLotes: number;
  diferencia: number;
  accion: string;
};

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(
    aplicar
      ? '⚠️  MODO APLICAR — se van a escribir cambios'
      : '🔍 SIMULACRO — no se escribe nada (usar --aplicar para ejecutar)',
  );
  console.log('');

  try {
    // Solo lo que tiene algo que conciliar: stock vivo o lotes vivos. Un
    // producto en cero y sin lotes ya cumple la invariante.
    const stocks = await prisma.productoStock.findMany({
      where: {
        OR: [{ stockActual: { gt: 0 } }, { lotes: { some: { estado: { in: ['ACTIVO', 'VENCIDO'] } } } }],
      },
      select: {
        id: true,
        empresaId: true,
        sedeId: true,
        productoId: true,
        varianteId: true,
        stockActual: true,
        precioCosto: true,
        sede: { select: { nombre: true } },
        producto: { select: { nombre: true } },
        variante: { select: { nombre: true } },
        lotes: {
          where: { estado: { in: ['ACTIVO', 'VENCIDO'] } },
          select: {
            id: true,
            codigo: true,
            cantidadActual: true,
            fechaVencimiento: true,
            fechaIngreso: true,
          },
          orderBy: [{ fechaIngreso: 'asc' }, { creadoEn: 'asc' }],
        },
      },
    });

    const resumen: Resumen[] = [];
    let creados = 0;
    let descontados = 0;
    let yaOk = 0;

    for (const s of stocks) {
      const sumaLotes = s.lotes.reduce((a, l) => a + l.cantidadActual, 0);
      const diferencia = s.stockActual - sumaLotes;
      const nombre =
        s.variante?.nombre ?? s.producto?.nombre ?? '(sin nombre)';

      if (diferencia === 0) {
        yaOk++;
        continue;
      }

      if (diferencia < 0) {
        // Sobran unidades en los lotes: son ventas pasadas nunca descontadas.
        let restante = -diferencia;
        const orden = [...s.lotes].sort((a, b) => {
          const va = a.fechaVencimiento;
          const vb = b.fechaVencimiento;
          if (va && vb) return va.getTime() - vb.getTime();
          if (va) return -1;
          if (vb) return 1;
          return a.fechaIngreso.getTime() - b.fechaIngreso.getTime();
        });

        for (const l of orden) {
          if (restante <= 0) break;
          const quita = Math.min(l.cantidadActual, restante);
          const queda = l.cantidadActual - quita;
          if (aplicar) {
            await prisma.lote.update({
              where: { id: l.id },
              data: {
                cantidadActual: queda,
                ...(queda === 0 ? { estado: 'AGOTADO' as const } : {}),
                observaciones: `Conciliación pre-FEFO: -${quita} (ventas históricas no descontadas)`,
              },
            });
          }
          restante -= quita;
        }
        descontados++;
        resumen.push({
          productoStockId: s.id,
          nombre,
          sede: s.sede.nombre,
          stockActual: s.stockActual,
          sumaLotes,
          diferencia,
          accion: `descontar ${-diferencia} de los lotes`,
        });
        continue;
      }

      // Faltan lotes: stock que entró sin pasar por una compra.
      // `fechaIngreso` un día antes del lote más viejo (o de hoy si no hay
      // ninguno) para que NUNCA sea el más reciente.
      const masViejo = s.lotes[0]?.fechaIngreso ?? new Date();
      const fechaApertura = new Date(masViejo.getTime() - 24 * 60 * 60 * 1000);

      if (aplicar) {
        await prisma.lote.create({
          data: {
            empresaId: s.empresaId,
            sedeId: s.sedeId,
            productoStockId: s.id,
            productoId: s.productoId,
            varianteId: s.varianteId,
            // Único por construcción: un solo lote de apertura por stock.
            codigo: `APERTURA-${s.id}`,
            precioCosto: s.precioCosto ?? new Prisma.Decimal(0),
            moneda: 'PEN',
            cantidadInicial: diferencia,
            cantidadActual: diferencia,
            fechaIngreso: fechaApertura,
            observaciones:
              'Lote de apertura (conciliación pre-FEFO): stock anterior al ' +
              'control por lote, valorado al costo promedio. Sin vencimiento ' +
              'porque nadie lo declaró.',
            creadoPor: 'SYSTEM',
          },
        });
      }
      creados++;
      resumen.push({
        productoStockId: s.id,
        nombre,
        sede: s.sede.nombre,
        stockActual: s.stockActual,
        sumaLotes,
        diferencia,
        accion: `crear lote de apertura de ${diferencia}`,
      });
    }

    console.log(`Revisados:            ${stocks.length}`);
    console.log(`Ya cuadraban:         ${yaOk}`);
    console.log(`Lotes de apertura:    ${creados}`);
    console.log(`Con exceso a quitar:  ${descontados}`);
    console.log('');

    if (resumen.length) {
      console.log('Detalle (primeros 40):');
      console.table(
        resumen.slice(0, 40).map((r) => ({
          producto: r.nombre.slice(0, 34),
          sede: r.sede.slice(0, 16),
          stock: r.stockActual,
          lotes: r.sumaLotes,
          dif: r.diferencia,
          accion: r.accion,
        })),
      );
      if (resumen.length > 40) {
        console.log(`… y ${resumen.length - 40} más`);
      }
    }

    if (!aplicar && resumen.length) {
      console.log('');
      console.log('Nada se escribió. Para aplicar:');
      console.log('  npx ts-node scripts/conciliar-lotes.ts --aplicar');
    }
    if (aplicar) {
      console.log('');
      console.log('✅ Conciliado. Recién AHORA se puede poner LOTES_FEFO_ENABLED=true.');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
