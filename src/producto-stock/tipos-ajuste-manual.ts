import { TipoMovimientoStock } from '@prisma/client';

/**
 * Qué se puede registrar a mano con `PUT producto-stock/:id/ajustar`, y con
 * qué signo.
 *
 * El ajuste manual solo mueve `stockActual`. El resto del enum tiene su propio
 * flujo, que además mueve otra cosa (la reserva, el dañado, la garantía) o
 * cuelga de un documento (la venta, la transferencia, la compra). Registrarlos
 * por acá deja un kardex que miente: en prod hay una "Reserva venta" de 24
 * unidades que en realidad las SACÓ del stock.
 *
 * 🔴 El que más mordía: el app ofrecía los 30 tipos y arrancaba con "Entrada
 * por compra" ya elegido. Sin compra detrás, esa entrada quedaba SIN lote.
 *
 * ⚠️ `AJUSTE_MERMA` acá es mercadería que se pierde y SALE del stock. En
 * incidencias y transferencias el mismo tipo marca DAÑADO sin tocar
 * `stockActual`: el tipo solo no alcanza para saber qué pasó con el stock.
 */
export const TIPOS_AJUSTE_MANUAL: Partial<
  Record<TipoMovimientoStock, 'ENTRADA' | 'SALIDA'>
> = {
  AJUSTE_ENTRADA: 'ENTRADA',
  AJUSTE_ENCONTRADO: 'ENTRADA',
  AJUSTE_SALIDA: 'SALIDA',
  AJUSTE_MERMA: 'SALIDA',
  AJUSTE_PERDIDA: 'SALIDA',
  SALIDA_BAJA: 'SALIDA',
  SALIDA_DONACION: 'SALIDA',

  // ── Solo por compatibilidad: ni la web ni el app nuevos los ofrecen ──
  // Los manda el APK que está en la calle (`ENTRADA_COMPRA` es su tipo por
  // defecto: 17 ajustes en los últimos 60 días) y el stock inicial del app
  // (`ENTRADA_AJUSTE`). Rechazarlos rompería flujos en uso.
  ENTRADA_COMPRA: 'ENTRADA',
  AJUSTE_ENTRADA_COMPRA: 'ENTRADA',
  ENTRADA_AJUSTE: 'ENTRADA',
  SALIDA_AJUSTE: 'SALIDA',
  SALIDA_MERMA: 'SALIDA',
  SALIDA_ROBO: 'SALIDA',
};

/** El motivo del rechazo, o `null` si el ajuste es válido. */
export function validarAjusteManual(
  tipo: TipoMovimientoStock,
  cantidad: number,
): string | null {
  const sentido = TIPOS_AJUSTE_MANUAL[tipo];
  if (!sentido) {
    return (
      'Ese tipo de movimiento no se registra con un ajuste de stock: lo genera ' +
      'su propio módulo (ventas, reservas, transferencias, garantías, ' +
      'producción). Para corregir el stock use un ajuste de entrada o de salida.'
    );
  }
  if (cantidad === 0) {
    return 'La cantidad del ajuste no puede ser 0.';
  }
  if (sentido === 'ENTRADA' && cantidad < 0) {
    return 'Un movimiento de entrada no puede restar stock.';
  }
  if (sentido === 'SALIDA' && cantidad > 0) {
    return 'Un movimiento de salida no puede sumar stock.';
  }
  return null;
}
