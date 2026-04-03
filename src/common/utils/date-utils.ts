/**
 * Utilidades centralizadas de fecha para todo el proyecto.
 *
 * REGLA: La base de datos guarda timestamps en UTC (timestamptz de PostgreSQL).
 * Para cálculos de negocio (hoy, esta semana, este mes) convertimos a hora Perú (UTC-5).
 *
 * "Medianoche Perú" = 05:00 UTC
 */

const PERU_UTC_OFFSET_HOURS = 5; // Perú es UTC-5, así que medianoche Perú = +5h en UTC

/**
 * Obtiene la fecha/hora actual en Perú
 */
export function getNowPeru(): Date {
  const now = new Date();
  // Restar 5 horas a UTC para obtener hora Perú
  return new Date(now.getTime() - PERU_UTC_OFFSET_HOURS * 3600000);
}

/**
 * Obtiene el inicio del día de hoy (medianoche Perú) expresado en UTC.
 * Si en Perú es 3 de abril, retorna 2026-04-03T05:00:00Z
 */
export function getTodayStart(): Date {
  const peru = getNowPeru();
  // Medianoche de ese día en Perú = ese día a las 05:00 UTC
  return new Date(Date.UTC(peru.getUTCFullYear(), peru.getUTCMonth(), peru.getUTCDate(), PERU_UTC_OFFSET_HOURS, 0, 0));
}

/**
 * Obtiene el inicio de mañana (medianoche Perú) expresado en UTC.
 */
export function getTomorrowStart(): Date {
  const today = getTodayStart();
  return new Date(today.getTime() + 24 * 3600000);
}

/**
 * Obtiene el inicio de la semana (lunes, medianoche Perú) expresado en UTC.
 */
export function getWeekStart(): Date {
  const peru = getNowPeru();
  const day = peru.getUTCDay(); // 0=dom, 1=lun, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(peru.getUTCFullYear(), peru.getUTCMonth(), peru.getUTCDate() + diff, PERU_UTC_OFFSET_HOURS, 0, 0));
  return monday;
}

/**
 * Obtiene el inicio del mes actual (día 1, medianoche Perú) expresado en UTC.
 */
export function getMonthStart(): Date {
  const peru = getNowPeru();
  return new Date(Date.UTC(peru.getUTCFullYear(), peru.getUTCMonth(), 1, PERU_UTC_OFFSET_HOURS, 0, 0));
}

/**
 * Obtiene el inicio del año actual (1 enero, medianoche Perú) expresado en UTC.
 */
export function getYearStart(): Date {
  const peru = getNowPeru();
  return new Date(Date.UTC(peru.getUTCFullYear(), 0, 1, PERU_UTC_OFFSET_HOURS, 0, 0));
}

/**
 * Convierte un string de fecha (yyyy-MM-dd) al inicio del día en Perú, expresado en UTC.
 * "2026-04-02" → 2026-04-02T05:00:00Z (medianoche Perú)
 */
export function parseStartOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, PERU_UTC_OFFSET_HOURS, 0, 0));
}

/**
 * Convierte un string de fecha (yyyy-MM-dd) al final del día en Perú, expresado en UTC.
 * "2026-04-02" → 2026-04-03T04:59:59.999Z (23:59:59 Perú)
 */
export function parseEndOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, PERU_UTC_OFFSET_HOURS, 0, 0) - 1);
}

/**
 * Obtiene la fecha actual del negocio (Perú) como string yyyy-MM-dd
 */
export function getTodayString(): string {
  const peru = getNowPeru();
  const y = peru.getUTCFullYear();
  const m = String(peru.getUTCMonth() + 1).padStart(2, '0');
  const d = String(peru.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
