import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { AppLoggerService } from './common/logger/logger.service';
import { logger as winstonLogger } from './common/logger/winston.config';
import helmet from 'helmet';

// Capturar errores no manejados
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  winstonLogger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  winstonLogger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  // No exit - let Docker handle restart if needed
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new AppLoggerService(),
    bufferLogs: true,
    // Necesario para validar HMAC de webhooks sobre el body crudo.
    // Disponible en `req.rawBody` para las rutas que lo necesiten.
    rawBody: true,
  });

  // 🔴 Sin esto rige el default de Express: 100 kB, y cualquier adjunto en
  // base64 rebota con "request entity too large".
  //
  // Paso el 06-09: compartir la ficha de un producto por WhatsApp fallaba
  // siempre --el PNG a 1080 px pesa megas-- mientras que el estado de cuenta
  // funcionaba, porque su PDF son unos 50 kB. nginx no tenia nada que ver:
  // el proxy admite 2000m.
  //
  // 12 MB deja pasar el tope real, que es el del DTO: MaxLength(8_000_000)
  // de base64 ≈ 6 MB de archivo. El que decide sigue siendo el DTO, no esto.
  app.useBodyParser('json', { limit: '12mb' });
  app.useBodyParser('urlencoded', { limit: '12mb', extended: true });

  // Usar el logger personalizado
  app.useLogger(app.get(AppLoggerService));

  const configService = app.get(ConfigService);
  const appLogger = app.get(AppLoggerService);
  appLogger.setContext('Bootstrap');

  const port = configService.get('PORT') || configService.get('APP_PORT') || 3001;

  // Verificar conexión a base de datos
  appLogger.info('Verificando conexión a la base de datos...');
  const dbStartTime = Date.now();

  try {
    const prismaService = app.get(PrismaService);
    await prismaService.$connect();
    const connectionTime = Date.now() - dbStartTime;

    appLogger.success('Base de datos conectada exitosamente', { connectionTime });

    // Test simple query para verificar la conexión
    const queryStartTime = Date.now();
    await prismaService.$queryRaw`SELECT 1`;
    const queryTime = Date.now() - queryStartTime;
    appLogger.debug('Database query verification OK', { queryTime });

    // Obtener información de la base de datos
    try {
      // Para PostgreSQL
      const dbInfo = await prismaService.$queryRaw`
        SELECT
          version() as version,
          current_database() as database,
          current_user as user,
          inet_server_addr() as server_ip,
          inet_server_port() as server_port
      `;

      const info = dbInfo[0] as any;
      console.log(`🗄️  Motor: PostgreSQL`);
      console.log(`📦 Base de datos: ${info.database}`);
      console.log(`👤 Usuario: ${info.user}`);
      console.log(`🌐 Servidor: ${info.server_ip}:${info.server_port}`);
      console.log(`🏷️  Versión: ${info.version?.split(' ')[1] || info.version}`);

    } catch (infoError) {
      console.log('ℹ️  No se pudo obtener información detallada de la BD (puede no ser PostgreSQL)');
    }

    // Verificar tablas principales si existen
    try {
      const tables = await prismaService.$queryRaw`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
        LIMIT 5
      `;

      const tableNames = (tables as any[]).map(t => (t as any).table_name);
      console.log(`📋 Tablas encontradas: ${tableNames.length > 0 ? tableNames.join(', ') : 'Ninguna'}`);

    } catch (tableError) {
      console.log('ℹ️  No se pudo verificar las tablas');
    }

    // Verificar migraciones de Prisma
    try {
      const migrations = await prismaService.$queryRaw`
        SELECT COUNT(*) as count
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
      `;

      const migrationCount = (migrations as any[])[0]?.count || 0;
      console.log(`🔄 Migraciones aplicadas: ${migrationCount}`);

    } catch (migrationError) {
      console.log('ℹ️  Tabla de migraciones no encontrada');
    }

  } catch (error: any) {
    appLogger.error('Error al conectar a la base de datos', error?.stack);
    appLogger.warn('La aplicación continuará, pero la conexión a la base de datos falló');
    appLogger.warn('Verifica tu archivo .env y la configuración de la base de datos');

    // Intentar mostrar más ayuda
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED')) {
        console.log('💡 Sugerencia: Verifica que el servidor de la base de datos esté corriendo');
      } else if (error.message.includes('authentication failed')) {
        console.log('💡 Sugerencia: Verifica las credenciales de la base de datos');
      } else if (error.message.includes('database') && error.message.includes('does not exist')) {
        console.log('💡 Sugerencia: La base de datos no existe, créala primero');
      }
    }
  }

  // Seguridad HTTP headers
  app.use(helmet({
    contentSecurityPolicy: false, // Deshabilitado para Swagger UI
    crossOriginEmbedderPolicy: false,
  }));

  // CORS
  const corsOriginEnv = configService.get('CORS_ORIGIN');
  const corsOrigins = corsOriginEnv
    ? corsOriginEnv.split(',').map((o: string) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-tenant-id'],
  });

  // Prefijo global de API
  app.setGlobalPrefix('api');

  // Validación global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Eliminar propiedades no definidas en DTO
      forbidNonWhitelisted: true, // Lanzar error si hay propiedades extra
      transform: true,            // Transformar tipos automáticamente
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('SaaS Multi-Empresa API')
    .setDescription('API para sistema multi-empresa de productos y servicios')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Ingresa tu token JWT',
        in: 'header',
      },
      'access-token',
    )
    .addTag('Auth', 'Endpoints de autenticación')
    .addTag('Usuarios', 'Gestión de usuarios')
    .addTag('Empresas', 'Gestión de empresas')
    .addTag('Productos', 'Gestión de productos')
    .addTag('Servicios', 'Gestión de servicios')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  await app.listen(port);

  // Logs de inicio
  winstonLogger.info('╔═══════════════════════════════════════════════════════════╗');
  winstonLogger.info('║   🚀 SERVIDOR INICIADO CORRECTAMENTE                      ║');
  winstonLogger.info('╠═══════════════════════════════════════════════════════════╣');
  winstonLogger.info(`║   📡 REST API:     http://localhost:${port}/api           ║`);
  winstonLogger.info(`║   📚 Swagger:      http://localhost:${port}/api/docs      ║`);
  winstonLogger.info(`║   📊 Logs:         ./logs/                               ║`);
  winstonLogger.info('╚═══════════════════════════════════════════════════════════╝');

  appLogger.info('Application started successfully', {
    port,
    environment: process.env.NODE_ENV || 'development',
    corsOrigins,
    nodeVersion: process.version,
    platform: process.platform,
  });
}

bootstrap();
