/**
 * One-off: corre migrarDigitalHistorico para JAYLI en PROD usando el MISMO
 * @prisma/client del container (réplica EXACTA de CajaService.migrarDigitalHistorico).
 * Idempotente: re-ejecutar no hace nada (el EGRESO deja el digital de la central en 0).
 *
 *   node scripts/migrar-digital-historico-jayli.cjs
 */
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EMPRESA_ID = 'cmowx0vls000601m7co65in3n';        // JAYLI FLORES S.A.C.
const USUARIO_ID = 'cmowwwd2p000101m7laga8hwn';         // jayli.f7@gmail.com (operador)

const r2 = (n) => Math.round(n * 100) / 100;

async function migrar() {
  return prisma.$transaction(async (tx) => {
    const centrales = await tx.caja.findMany({
      where: { empresaId: EMPRESA_ID, esCajaCentral: true },
      select: { id: true, sedeId: true, codigo: true },
    });
    const recaud = await tx.cuentaRecaudacion.findMany({
      where: { empresaId: EMPRESA_ID },
      include: { banco: { select: { id: true, isActive: true, moneda: true, nombreBanco: true } } },
    });
    const mapa = new Map(recaud.map((r) => [r.metodoPago, r.banco]));

    const movido = [];
    const omitido = [];
    let totalMovido = 0;

    for (const central of centrales) {
      const totales = await tx.movimientoCaja.groupBy({
        by: ['metodoPago', 'tipo'],
        where: { cajaId: central.id, anulado: false },
        _sum: { monto: true },
      });
      const saldoPorMetodo = {};
      for (const row of totales) {
        if (row.metodoPago === 'EFECTIVO') continue; // efectivo = bóveda
        const m = Number(row._sum.monto ?? 0);
        saldoPorMetodo[row.metodoPago] =
          (saldoPorMetodo[row.metodoPago] ?? 0) + (row.tipo === 'INGRESO' ? m : -m);
      }

      for (const [metodo, saldoRaw] of Object.entries(saldoPorMetodo)) {
        const monto = r2(saldoRaw);
        if (monto <= 0) continue;

        const banco = mapa.get(metodo);
        if (!banco || !banco.isActive || (banco.moneda ?? 'PEN') !== 'PEN') {
          omitido.push({
            sedeId: central.sedeId,
            metodo,
            monto,
            razon: !banco ? 'sin cuenta de recaudación' : 'banco inactivo o no-PEN',
          });
          continue;
        }

        // 1) EGRESO en la central: saca el digital de la bóveda.
        await tx.movimientoCaja.create({
          data: {
            cajaId: central.id,
            empresaId: EMPRESA_ID,
            tipo: 'EGRESO',
            categoria: 'AJUSTE_TESORERIA',
            metodoPago: metodo,
            monto,
            descripcion: `[MIGRACIÓN] Digital histórico ${metodo} → ${banco.nombreBanco}`,
            esManual: true,
            registradoPorId: USUARIO_ID,
            metadata: { migracionDigital: true, bancoId: banco.id },
          },
        });

        // 2) Incrementa el saldo del banco.
        const cuenta = await tx.empresaBanco.findUnique({
          where: { id: banco.id },
          select: { saldoActual: true },
        });
        const anterior = cuenta?.saldoActual != null ? Number(cuenta.saldoActual) : 0;
        await tx.empresaBanco.update({
          where: { id: banco.id },
          data: { saldoActual: r2(anterior + monto) },
        });

        movido.push({ sedeId: central.sedeId, metodo, monto, bancoId: banco.id, nombreBanco: banco.nombreBanco });
        totalMovido += monto;
      }
    }

    return { movido, omitido, totalMovido: r2(totalMovido) };
  });
}

migrar()
  .then((res) => {
    console.log('RESULTADO migrarDigitalHistorico:');
    console.log(JSON.stringify(res, null, 2));
  })
  .catch((e) => {
    console.error('ERROR:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
