import { plainToClass, Transform } from 'class-transformer';
import { IsString, IsNumber, IsOptional, IsIn, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @Transform(({ value }) => value?.trim())
  DATABASE_URL: string;

  @IsString()
  @Transform(({ value }) => value?.trim())
  JWT_SECRET: string;

  @IsString()
  @IsIn(['15m', '30m', '1h', '2h', '24h'])
  JWT_EXPIRES_IN: string = '24h';

  @IsString()
  @Transform(({ value }) => value?.trim())
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsIn(['1d', '7d', '30d'])
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  PORT: number = 3001;

  @IsString()
  @IsIn(['development', 'production', 'staging', 'test'])
  NODE_ENV: string = 'development';

  @IsString()
  @Transform(({ value }) => value?.trim())
  REDIS_URL: string;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  REDIS_SESSION_TTL: number = 604800;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  MAX_LOGIN_ATTEMPTS: number = 5;

  @IsNumber()
  @Transform(({ value }) => parseInt(value, 10))
  LOCKOUT_DURATION_MINUTES: number = 15;

  @IsString()
  @Transform(({ value }) => value?.trim())
  @IsOptional()
  REDIS_PASSWORD?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Configuration validation error: ${errors.toString()}`);
  }

  // Validaciones adicionales de seguridad
  if (validatedConfig.NODE_ENV === 'production') {
    if (validatedConfig.JWT_SECRET.length < 64) {
      throw new Error('JWT_SECRET must be at least 64 characters in production');
    }
    if (validatedConfig.JWT_REFRESH_SECRET.length < 64) {
      throw new Error('JWT_REFRESH_SECRET must be at least 64 characters in production');
    }
    if (validatedConfig.JWT_SECRET === validatedConfig.JWT_REFRESH_SECRET) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different');
    }
  }

  return validatedConfig;
}