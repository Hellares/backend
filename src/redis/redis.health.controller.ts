import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RedisService } from './redis.service';

@ApiTags('Redis Health')
@Controller('redis')
export class RedisHealthController {
  constructor(private readonly redisService: RedisService) {}

  @Get('health')
  @ApiOperation({ summary: 'Verificar conexión a Redis' })
  @ApiResponse({ status: 200, description: 'Redis está conectado y funcionando' })
  @ApiResponse({ status: 503, description: 'Error de conexión a Redis' })
  async checkRedis() {
    const isHealthy = await this.redisService.ping();

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      connected: isHealthy
    };
  }

  @Get('test')
  @ApiOperation({ summary: 'Probar operaciones básicas de Redis' })
  @ApiResponse({ status: 200, description: 'Operaciones de Redis funcionando' })
  async testRedis() {
    const testKey = 'test:redis:connection';
    const testValue = 'Redis está funcionando!';

    try {
      // Test SET
      const setResult = await this.redisService.set(testKey, testValue);

      // Test GET
      const getValue = await this.redisService.get(testKey);

      // Test DELETE
      const deleteResult = await this.redisService.del(testKey);

      return {
        success: true,
        operations: {
          set: setResult,
          get: getValue,
          delete: deleteResult
        },
        message: 'Todas las operaciones básicas funcionan correctamente'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Error en las operaciones de Redis'
      };
    }
  }

  @Get('debug-sessions')
  @ApiOperation({ summary: 'Debug sessions en Redis' })
  async debugSessions() {
    try {
      const userId = 'cmhsmtt6z000aud8snijk6iir'; // Tu ID de usuario
      const userSessionsKey = `user_sessions:${userId}`;

      // Obtener todos los session IDs del usuario
      const sessionIds = await this.redisService.smembers(userSessionsKey);

      const sessions = [];

      for (const sessionId of sessionIds) {
        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.redisService.get(sessionKey);

        if (sessionData) {
          try {
            const session = JSON.parse(sessionData);
            sessions.push({
              sessionId,
              sessionData: session,
              isActive: session.isActive,
              expiresAt: session.expiresAt,
              isExpired: new Date(session.expiresAt) < new Date()
            });
          } catch (parseError) {
            sessions.push({
              sessionId,
              error: 'Invalid session data',
              rawData: sessionData
            });
          }
        }
      }

      // También buscar cualquier clave que contenga 'session'
      const allSessionKeys = await this.redisService.getKeysByPattern('*session*');

      return {
        userSessionsKey,
        sessionIds,
        sessions,
        totalSessionIds: sessionIds.length,
        totalSessions: sessions.length,
        activeSessions: sessions.filter(s => s.isActive && !s.isExpired).length,
        allSessionKeys,
        debug: {
          userId,
          currentTime: new Date(),
          redisWorking: true
        }
      };
    } catch (error) {
      return {
        error: error.message,
        message: 'Error al depurar sesiones',
        redisWorking: false
      };
    }
  }
}