import { Rol } from '@prisma/client';

export interface JwtPayload {
  sub: string;        // Usuario ID
  email: string;      // Email del usuario
  personaId: string;  // ID de la persona asociada
  nombres: string;    // Nombres del usuario
  apellidos: string;  // Apellidos del usuario

  // Multi-tenant
  tenantId?: string;  // Empresa ID actual
  tenantRole?: Rol;   // Rol en la empresa actual
  tenantName?: string; // Nombre de la empresa

  // Información de sesión
  sessionId?: string;
  loginMethod: 'local' | 'oauth' | 'sso';

  // Timestamps
  iat?: number;       // Issued at
  exp?: number;       // Expiration time
}

export interface RefreshTokenPayload {
  sub: string;        // Usuario ID
  sessionId: string;  // ID de sesión
  type: 'refresh';    // Tipo de token
  iat?: number;
  exp?: number;
}

export interface OAuthProfile {
  provider: string;
  providerId: string;
  email: string;
  nombres: string;
  apellidos?: string;
  foto?: string;
  emailVerificado: boolean;
}