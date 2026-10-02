import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cómo se ve en tesorería la plata de un DEPÓSITO del cliente.
 *
 * El ingreso real es el depósito (los S/ 300 que entraron al banco), no los
 * abonos en que después se repartió (S/ 51 a una venta): esos son un reparto
 * interno y NO mueven plata. Por eso un listado de ingresos bancarios tiene
 * que (1) sacar los abonos que salieron de un depósito y (2) poner el
 * depósito entero, con lo que todavía es saldo a favor del cliente.
 *
 * Sin esto el listado mostraba S/ 150 + S/ 51 mientras el saldo del banco
 * había subido S/ 450: los S/ 249 a favor no aparecían en ningún lado.
 */

/** De una lista de abonos, deja los que tuvieron ingreso propio (no salieron de un depósito). */
export async function sinAbonosDeDeposito<T extends { id: string }>(prisma: PrismaService, pagos: T[]): Promise<T[]> {
  if (!pagos.length) return pagos;
  const aplicaciones = await prisma.aplicacionDeposito.findMany({
    where: { pagoVentaId: { in: pagos.map((p) => p.id) } },
    select: { pagoVentaId: true },
  });
  if (!aplicaciones.length) return pagos;
  const deDeposito = new Set(aplicaciones.map((a) => a.pagoVentaId));
  return pagos.filter((p) => !deDeposito.has(p.id));
}

export interface DepositoEnBanco {
  id: string;
  bancoId: string;
  monto: number;
  /** Lo que todavía no se aplicó a ninguna venta: saldo a favor del cliente. */
  aFavor: number;
  metodoPago: string;
  fecha: Date;
  cliente: string;
}

/** Los depósitos de clientes que entraron a un banco (no anulados). */
export async function depositosEnBanco(
  prisma: PrismaService,
  filtro: { empresaId: string; bancoId?: string; sedeId?: string; rango?: Prisma.DateTimeFilter },
): Promise<DepositoEnBanco[]> {
  const filas = await prisma.depositoCliente.findMany({
    where: {
      empresaId: filtro.empresaId,
      anulado: false,
      fuente: 'BANCO',
      bancoId: filtro.bancoId ?? { not: null },
      ...(filtro.sedeId ? { sedeId: filtro.sedeId } : {}),
      ...(filtro.rango ? { creadoEn: filtro.rango } : {}),
    },
    orderBy: { creadoEn: 'desc' },
    take: 500,
    select: {
      id: true, bancoId: true, monto: true, montoAplicado: true, metodoPago: true, creadoEn: true,
      clienteId: true, clienteEmpresaId: true,
    },
  });
  if (!filas.length) return [];

  const epIds = [...new Set(filas.map((f) => f.clienteId).filter((x): x is string => !!x))];
  const ceIds = [...new Set(filas.map((f) => f.clienteEmpresaId).filter((x): x is string => !!x))];
  const [eps, ces] = await Promise.all([
    epIds.length
      ? prisma.empresaPersona.findMany({
          where: { id: { in: epIds } },
          select: { id: true, persona: { select: { nombres: true, apellidos: true } } },
        })
      : [],
    ceIds.length
      ? prisma.clienteEmpresa.findMany({ where: { id: { in: ceIds } }, select: { id: true, razonSocial: true } })
      : [],
  ]);
  const nombre = new Map<string, string>();
  for (const e of eps) nombre.set(e.id, [e.persona?.nombres, e.persona?.apellidos].filter(Boolean).join(' '));
  for (const c of ces) nombre.set(c.id, c.razonSocial);

  return filas.map((f) => ({
    id: f.id,
    bancoId: f.bancoId!,
    monto: Number(f.monto),
    aFavor: Math.max(0, Math.round((Number(f.monto) - Number(f.montoAplicado)) * 100) / 100),
    metodoPago: f.metodoPago,
    fecha: f.creadoEn,
    cliente: nombre.get(f.clienteEmpresaId ?? f.clienteId ?? '') || 'Cliente',
  }));
}
