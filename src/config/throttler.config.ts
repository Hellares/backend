/**
 * Configuración de Throttler (Rate Limiting HTTP)
 * Lee valores desde variables de entorno
 *
 * IMPORTANTE: El ThrottlerGuard usa SOLO el throttler 'default'
 * Los throttlers nombrados no se usan automáticamente en NestJS v10+
 */
export const throttlerConfig = {
  throttlers: [
    {
      ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10), // 60 segundos = 1 minuto
      limit: parseInt(process.env.THROTTLE_LIMIT || '10', 10), // 10 requests por minuto
    }
  ]
};