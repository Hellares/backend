import { Prisma } from '@prisma/client';

/**
 * Tipos de contador de código. Uno por cada `ultimo*` que antes era una columna
 * de `ConfiguracionCodigos`. Los valores viajan como texto a la columna `tipo`
 * de `ContadorCodigo` y tienen que coincidir EXACTAMENTE con los del backfill
 * de la migración `20260827000000_contador_codigo_fila_por_tipo`.
 *
 * NO están acá los 7 correlativos de `Sede` (`ultimoNumeroFactura`,
 * `ultimoNumeroBoleta`…): esos son fiscales, los pide SUNAT sin huecos y ya
 * están bloqueados por sede con FOR UPDATE.
 */
export type TipoContador =
  | 'PRODUCTO'
  | 'SERVICIO'
  | 'VARIANTE'
  | 'VENTA'
  | 'COMPONENTE'
  | 'COTIZACION'
  | 'ORDEN_SERVICIO'
  | 'PROVEEDOR'
  | 'TRANSFERENCIA'
  | 'ORDEN_COMPRA'
  | 'COMPRA'
  | 'LOTE'
  | 'SEDE'
  | 'REPORTE_INCIDENCIA'
  | 'INVENTARIO'
  | 'CLIENTE_EMPRESA'
  | 'CITA'
  | 'PEDIDO_MARKETPLACE'
  | 'SOLICITUD_COTIZACION'
  | 'CAJA'
  | 'RENDICION'
  | 'EMPLEADO';

export const TIPOS_CONTADOR: readonly TipoContador[] = [
  'PRODUCTO',
  'SERVICIO',
  'VARIANTE',
  'VENTA',
  'COMPONENTE',
  'COTIZACION',
  'ORDEN_SERVICIO',
  'PROVEEDOR',
  'TRANSFERENCIA',
  'ORDEN_COMPRA',
  'COMPRA',
  'LOTE',
  'SEDE',
  'REPORTE_INCIDENCIA',
  'INVENTARIO',
  'CLIENTE_EMPRESA',
  'CITA',
  'PEDIDO_MARKETPLACE',
  'SOLICITUD_COTIZACION',
  'CAJA',
  'RENDICION',
  'EMPLEADO',
] as const;

/**
 * Reserva el siguiente número de un contador y lo devuelve.
 *
 * Un solo statement: crea la fila si no existe, la sube a `minimo` si la base
 * quedó adelantada respecto del contador (restauración de backup, corrección a
 * mano) y la incrementa. Antes esto eran DOS viajes a la base — un
 * `UPDATE … GREATEST` y un `update({ increment: 1 })` — los dos con el lock
 * tomado.
 *
 * El lock de la fila se sostiene hasta el commit de `tx`, y tiene que ser así:
 * si se soltara antes, una venta que después falla dejaría un hueco en la
 * numeración. Lo que se ganó es que ese lock ya no es compartido entre tipos —
 * una compra y una venta ya no se estorban.
 *
 * @param minimo piso conocido leído de la tabla del documento. El contador
 *   nunca baja: se toma `GREATEST(valor, minimo)` antes de sumar 1.
 */
export async function siguienteContador(
  tx: Prisma.TransactionClient,
  empresaId: string,
  tipo: TipoContador,
  minimo = 0,
): Promise<number> {
  const filas = await tx.$queryRaw<Array<{ valor: number }>>`
    INSERT INTO "ContadorCodigo" ("id", "empresaId", "tipo", "valor", "actualizadoEn")
    VALUES (
      'ctr_' || md5(${empresaId}::text || ':' || ${tipo}::text),
      ${empresaId},
      ${tipo},
      GREATEST(${minimo}::int, 0) + 1,
      now()
    )
    ON CONFLICT ("empresaId", "tipo") DO UPDATE
      SET "valor" = GREATEST("ContadorCodigo"."valor", ${minimo}::int) + 1,
          "actualizadoEn" = now()
    RETURNING "valor"`;

  const valor = filas[0]?.valor;
  if (valor == null) {
    throw new Error(
      `No se pudo reservar el contador ${tipo} de la empresa ${empresaId}`,
    );
  }
  return valor;
}

/**
 * Deja el contador EXACTAMENTE en `valor` (no incrementa). Solo para la
 * sincronización manual, que reconstruye el contador desde la tabla real.
 */
export async function fijarContador(
  tx: Prisma.TransactionClient,
  empresaId: string,
  tipo: TipoContador,
  valor: number,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "ContadorCodigo" ("id", "empresaId", "tipo", "valor", "actualizadoEn")
    VALUES (
      'ctr_' || md5(${empresaId}::text || ':' || ${tipo}::text),
      ${empresaId},
      ${tipo},
      GREATEST(${valor}::int, 0),
      now()
    )
    ON CONFLICT ("empresaId", "tipo") DO UPDATE
      SET "valor" = GREATEST(${valor}::int, 0),
          "actualizadoEn" = now()`;
}

/**
 * Lee todos los contadores de una empresa de una sola vez. Los tipos que
 * todavia no tienen fila valen 0.
 *
 * Es solo para MOSTRAR (la pantalla de configuracion de codigos dice cual va
 * a ser el proximo). Para reservar un numero va siempre siguienteContador().
 */
export async function leerContadores(
  tx: Prisma.TransactionClient,
  empresaId: string,
): Promise<Record<TipoContador, number>> {
  const filas = await tx.$queryRaw<Array<{ tipo: string; valor: number }>>`
    SELECT "tipo", "valor" FROM "ContadorCodigo" WHERE "empresaId" = ${empresaId}`;

  const mapa = Object.fromEntries(
    TIPOS_CONTADOR.map((t) => [t, 0]),
  ) as Record<TipoContador, number>;

  for (const f of filas) {
    if (f.tipo in mapa) mapa[f.tipo as TipoContador] = f.valor;
  }
  return mapa;
}
