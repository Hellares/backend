import { Controller, Get, Param } from '@nestjs/common';
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

  @Get('debug-sessions/:userId')
  @ApiOperation({ summary: 'Debug sessions en Redis por userId' })
  async debugSessions(@Param('userId') userId: string) {
    try {
      const userSessionsKey = `user_sessions:${userId}`;

      const sessionIds = await this.redisService.smembers(userSessionsKey);

      const sessions = await Promise.all(
        sessionIds.map(async (sessionId) => {
          const sessionKey = `session:${sessionId}`;
          const sessionData = await this.redisService.get(sessionKey);

          if (!sessionData) return { sessionId, error: 'No data' };

          try {
            const session = JSON.parse(sessionData);
            return {
              sessionId,
              isActive: session.isActive,
              expiresAt: session.expiresAt,
              isExpired: new Date(session.expiresAt) < new Date(),
              tenantId: session.tenantId,
              tenantName: session.tenantName,
            };
          } catch {
            return { sessionId, error: 'Invalid session data' };
          }
        }),
      );

      return {
        userId,
        totalSessions: sessions.length,
        activeSessions: sessions.filter((s: any) => s.isActive && !s.isExpired).length,
        sessions,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        error: error.message,
        message: 'Error al depurar sesiones',
      };
    }
  }
}