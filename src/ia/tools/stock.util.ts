/** Fila de ProductoStock con los campos que afectan lo vendible. */
export interface FilaStock {
  stockActual: number;
  stockReservado: number;
  stockReservadoVenta: number;
  stockReservadoCombo: number;
  stockReservadoCotizacion: number;
  stockDanado: number;
  stockEnGarantia: number;
}

/**
 * Stock realmente VENDIBLE de una fila ProductoStock (mismo cálculo que
 * documenta stock.prisma: stockActual menos todas las reservas y no-vendibles).
 */
export function stockDisponible(s: FilaStock): number {
  return (
    s.stockActual -
    s.stockReservado -
    s.stockReservadoVenta -
    s.stockReservadoCombo -
    s.stockReservadoCotizacion -
    s.stockDanado -
    s.stockEnGarantia
  );
}
