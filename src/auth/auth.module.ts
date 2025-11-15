import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailModule } from '../email/email.module';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth.session.service';
import { AuthSecurityService } from './services/auth.security.service';
import { AuthController } from './auth.controller';
import { JwtStrategy, LocalStrategy } from './strategies';
import { TenantAuthGuard } from './guards';
import { throttlerConfig } from '../config/throttler.config';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ThrottlerModule.forRoot(throttlerConfig),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '24h'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AuthSecurityService,
    JwtStrategy,
    LocalStrategy,
    // Los guards básicos no necesitan ser registrados como providers
    // TenantAuthGuard necesita PrismaService, así que debe ser importado donde se use
  ],
  exports: [AuthService, AuthSessionService, JwtModule, JwtStrategy, LocalStrategy],
})
export class AuthModule {}
