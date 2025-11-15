import { Request } from 'express';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        id: string;
        personaId: string;
        rolGlobal?: string;
      };
      tenant?: {
        id: string;
        subdominio?: string;
        nombre?: string;
        [key: string]: any;
      };
      currentEmpresa?: {
        id: string;
        subdominio?: string;
        nombre?: string;
        [key: string]: any;
      };
    }
  }
}