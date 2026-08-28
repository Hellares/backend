import * as fs from 'fs';
import * as path from 'path';
import {
  siguienteContador,
  fijarContador,
  leerContadores,
  TIPOS_CONTADOR,
  TipoContador,
} from './contador-codigo.util';

/**
 * Los contadores de código dejaron de ser columnas de la única fila de
 * `ConfiguracionCodigos` para tener una fila propia por (empresa, tipo). El
 * motivo es de concurrencia: Postgres bloquea la FILA hasta el commit, así que
 * el contador de compras bloqueaba al de ventas.
 *
 * Lo que estos tests cuidan es lo que un typecheck no ve: que la lista de tipos
 * del TS y la del backfill de la migración no se separen, y que el helper haga
 * UN solo statement (si volvieran a ser dos, el lock se sostiene el doble).
 */
describe('contador-codigo.util', () => {
  const tx = () => {
    const queryRaw = jest.fn();
    const executeRaw = jest.fn();
    return {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      _sql: (m: jest.Mock) => (m.mock.calls[0][0] as string[]).join('?'),
    } as any;
  };

  describe('siguienteContador', () => {
    it('reserva el número con UN solo statement', async () => {
      const t = tx();
      t.$queryRaw.mockResolvedValue([{ valor: 42 }]);

      const n = await siguienteContador(t, 'emp-1', 'VENTA');

      expect(n).toBe(42);
      expect(t.$queryRaw).toHaveBeenCalledTimes(1);
      expect(t.$executeRaw).not.toHaveBeenCalled();
    });

    it('hace el upsert con GREATEST para no retroceder nunca', async () => {
      const t = tx();
      t.$queryRaw.mockResolvedValue([{ valor: 8 }]);

      await siguienteContador(t, 'emp-1', 'COMPRA', 7);

      const sql = t._sql(t.$queryRaw);
      expect(sql).toContain('INSERT INTO "ContadorCodigo"');
      expect(sql).toContain('ON CONFLICT ("empresaId", "tipo") DO UPDATE');
      expect(sql).toContain('GREATEST');
      expect(sql).toContain('RETURNING "valor"');
    });

    it('falla fuerte si la base no devuelve nada, en vez de seguir con undefined', async () => {
      const t = tx();
      t.$queryRaw.mockResolvedValue([]);

      await expect(siguienteContador(t, 'emp-1', 'VENTA')).rejects.toThrow(
        /No se pudo reservar el contador VENTA/,
      );
    });
  });

  describe('fijarContador', () => {
    it('deja el contador en el valor pedido sin incrementarlo', async () => {
      const t = tx();
      t.$executeRaw.mockResolvedValue(1);

      await fijarContador(t, 'emp-1', 'PRODUCTO', 130);

      expect(t.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = t._sql(t.$executeRaw);
      expect(sql).toContain('ON CONFLICT ("empresaId", "tipo") DO UPDATE');
      expect(sql).not.toContain('RETURNING');
    });
  });

  describe('leerContadores', () => {
    it('devuelve los 22 tipos, con 0 en los que todavía no tienen fila', async () => {
      const t = tx();
      t.$queryRaw.mockResolvedValue([
        { tipo: 'VENTA', valor: 17 },
        { tipo: 'COMPRA', valor: 3 },
      ]);

      const mapa = await leerContadores(t, 'emp-1');

      expect(Object.keys(mapa)).toHaveLength(22);
      expect(mapa.VENTA).toBe(17);
      expect(mapa.COMPRA).toBe(3);
      expect(mapa.PRODUCTO).toBe(0);
    });

    it('ignora un tipo desconocido en vez de meterlo en el mapa', async () => {
      const t = tx();
      t.$queryRaw.mockResolvedValue([{ tipo: 'INVENTADO', valor: 99 }]);

      const mapa = await leerContadores(t, 'emp-1');

      expect(mapa).not.toHaveProperty('INVENTADO');
      expect(Object.keys(mapa)).toHaveLength(22);
    });
  });

  /**
   * Si alguien agrega un contador al TS y se olvida del backfill, las empresas
   * que ya existen arrancan ese contador en 0 y repiten códigos. Al revés, un
   * tipo en la migración que el TS no conoce es una fila que nadie lee nunca.
   */
  it('la lista de tipos del TS es exactamente la del backfill de la migración', () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '../../prisma/migrations/20260827000000_contador_codigo_fila_por_tipo/migration.sql',
      ),
      'utf8',
    );

    const backfill = sql.slice(sql.indexOf('CROSS JOIN LATERAL (VALUES'));
    const enMigracion = [...backfill.matchAll(/\('([A-Z_]+)',/g)].map((m) => m[1]);

    expect(enMigracion.sort()).toEqual([...TIPOS_CONTADOR].sort());
  });

  it('no hay tipos repetidos en TIPOS_CONTADOR', () => {
    expect(new Set(TIPOS_CONTADOR).size).toBe(TIPOS_CONTADOR.length);
  });

  it('cada tipo del TS existe como valor del union', () => {
    // Falla en compilación si TIPOS_CONTADOR y TipoContador se separan.
    const todos: TipoContador[] = [...TIPOS_CONTADOR];
    expect(todos).toContain('VENTA');
  });
});
