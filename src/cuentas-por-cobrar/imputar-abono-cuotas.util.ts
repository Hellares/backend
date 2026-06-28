/**
 * Imputación de un abono a las cuotas de una venta a crédito.
 *
 * Réplica FIEL de la cascada que usa `VentaService.procesarPago` (mora →
 * interés → principal, cuota por cuota en orden), extraída como función PURA
 * para poder reusarla en:
 *   - `CuentasPorCobrarService.registrarAbono` (aplicar un abono nuevo)
 *   - `CuentasPorCobrarService.anularAbono` (recomputar cuotas desde cero
 *     reaplicando los abonos NO anulados)
 *
 * No toca la BD: recibe el estado de las cuotas y devuelve los nuevos valores.
 */

export interface CuotaImputable {
  id: string;
  monto: number;
  montoPrincipal: number;
  montoInteres: number;
  montoPagadoPrincipal: number;
  montoPagadoInteres: number;
  montoPagadoMora: number;
  fechaVencimiento: Date;
  estado: string;
}

export interface ConfigMoraImputacion {
  moraHabilitada: boolean;
  porcentajeMoraDiario: number;
  moraMaximaPorcentaje: number;
  diasGraciaMora: number;
}

export interface CuotaUpdate {
  id: string;
  montoPagado: number;
  montoPagadoPrincipal: number;
  montoPagadoInteres: number;
  montoPagadoMora: number;
  saldoPendiente: number;
  estado: 'PAGADA' | 'PAGADA_PARCIAL';
  montoMora: number;
  pagada: boolean;
}

export interface ImputacionResult {
  updates: CuotaUpdate[];
  breakdown: { principal: number; interes: number; mora: number };
  aplicadoTotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Mora vigente de una cuota AL MOMENTO `ahora` (misma fórmula que
 * `VentaService.moraVigente`).
 */
export function moraVigenteCuota(
  cuota: CuotaImputable,
  config: ConfigMoraImputacion | null,
  ahora: Date,
): number {
  if (!config?.moraHabilitada) return 0;
  if (cuota.estado === 'PAGADA') return 0;
  const diasGracia = config.diasGraciaMora ?? 0;
  const diasVencidos = Math.ceil(
    (ahora.getTime() - cuota.fechaVencimiento.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diasVencidos <= diasGracia) return 0;
  const diasAplicables = diasVencidos - diasGracia;
  const porcentajeMora = (config.porcentajeMoraDiario ?? 0.05) * diasAplicables;
  const moraCalculada = cuota.montoPrincipal * (porcentajeMora / 100);
  const moraMaxima =
    cuota.montoPrincipal * ((config.moraMaximaPorcentaje ?? 30) / 100);
  return Math.min(moraCalculada, moraMaxima);
}

/**
 * Imputa `monto` a las `cuotas` (deben venir ordenadas por número asc, y solo
 * las no canceladas). Cascada por cuota: mora → interés → principal.
 * Muta `cuota.montoPagado*` y `cuota.estado` EN MEMORIA para que reaplicaciones
 * sucesivas (recompute) vean el estado actualizado entre abonos.
 */
export function imputarEnCuotas(
  cuotas: CuotaImputable[],
  monto: number,
  config: ConfigMoraImputacion | null,
  ahora: Date,
): ImputacionResult {
  const updates: CuotaUpdate[] = [];
  let totalMora = 0;
  let totalInteres = 0;
  let totalPrincipal = 0;
  let remaining = monto;

  for (const cuota of cuotas) {
    if (remaining <= 0) break;

    const mora = moraVigenteCuota(cuota, config, ahora);
    const saldoInteres = round2(cuota.montoInteres - cuota.montoPagadoInteres);
    const saldoPrincipal = round2(cuota.montoPrincipal - cuota.montoPagadoPrincipal);
    const saldoTotal = mora + Math.max(saldoInteres, 0) + Math.max(saldoPrincipal, 0);
    const aplicar = Math.min(remaining, saldoTotal);

    // Prioridad: mora → interés → principal
    const moraAplicada = Math.min(aplicar, mora);
    let sobrante = aplicar - moraAplicada;
    const interesAplicado = Math.min(sobrante, Math.max(saldoInteres, 0));
    sobrante -= interesAplicado;
    const principalAplicado = Math.min(sobrante, Math.max(saldoPrincipal, 0));

    totalMora += moraAplicada;
    totalInteres += interesAplicado;
    totalPrincipal += principalAplicado;

    const nuevoPagadoPrincipal = round2(cuota.montoPagadoPrincipal + principalAplicado);
    const nuevoPagadoInteres = round2(cuota.montoPagadoInteres + interesAplicado);
    const nuevoPagadoMora = round2(cuota.montoPagadoMora + moraAplicada);
    const nuevoMontoPagado = round2(nuevoPagadoPrincipal + nuevoPagadoInteres);
    const nuevoSaldo = round2(cuota.monto - nuevoMontoPagado);
    const nuevaMora = round2(mora - moraAplicada);
    const pagada = nuevoSaldo <= 0 && nuevaMora <= 0;

    // Mutar en memoria (para reaplicaciones sucesivas en el recompute)
    cuota.montoPagadoPrincipal = nuevoPagadoPrincipal;
    cuota.montoPagadoInteres = nuevoPagadoInteres;
    cuota.montoPagadoMora = nuevoPagadoMora;
    cuota.estado = pagada ? 'PAGADA' : 'PAGADA_PARCIAL';

    updates.push({
      id: cuota.id,
      montoPagado: nuevoMontoPagado,
      montoPagadoPrincipal: nuevoPagadoPrincipal,
      montoPagadoInteres: nuevoPagadoInteres,
      montoPagadoMora: nuevoPagadoMora,
      saldoPendiente: Math.max(nuevoSaldo, 0),
      estado: pagada ? 'PAGADA' : 'PAGADA_PARCIAL',
      montoMora: pagada ? 0 : nuevaMora,
      pagada,
    });

    remaining = round2(remaining - aplicar);
  }

  return {
    updates,
    breakdown: {
      principal: round2(totalPrincipal),
      interes: round2(totalInteres),
      mora: round2(totalMora),
    },
    aplicadoTotal: round2(monto - remaining),
  };
}
