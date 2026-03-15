import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private app: admin.app.App;

  onModuleInit() {
    if (admin.apps.length > 0) {
      this.app = admin.apps[0]!;
      return;
    }

    // Buscar el archivo de service account
    const possiblePaths = [
      path.resolve(process.cwd(), 'firebase-service-account.json'),
      path.resolve(process.cwd(), '..', 'firebase-service-account.json'),
    ];

    // También buscar archivos que contengan "firebase-adminsdk" en el nombre
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd);
    const adminSdkFile = files.find(
      (f) => f.includes('firebase-adminsdk') && f.endsWith('.json'),
    );
    if (adminSdkFile) {
      possiblePaths.unshift(path.resolve(cwd, adminSdkFile));
    }

    let serviceAccount: admin.ServiceAccount | null = null;

    // Opción 1: Variable de entorno (para producción/Docker)
    const firebaseEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (firebaseEnv) {
      try {
        serviceAccount = JSON.parse(firebaseEnv) as admin.ServiceAccount;
        console.log('[Firebase] Service account loaded from environment variable');
      } catch (e) {
        console.error('[Firebase] Error parsing FIREBASE_SERVICE_ACCOUNT env var');
      }
    }

    // Opción 2: Archivo local (para desarrollo)
    if (!serviceAccount) {
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          serviceAccount = JSON.parse(
            fs.readFileSync(p, 'utf-8'),
          ) as admin.ServiceAccount;
          console.log(`[Firebase] Service account loaded from: ${p}`);
          break;
        }
      }
    }

    if (!serviceAccount) {
      console.warn(
        '[Firebase] No service account found (env var or file). Push notifications will not work.',
      );
      this.app = admin.initializeApp();
      return;
    }

    this.app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('[Firebase] Admin SDK initialized successfully');
  }

  /**
   * Enviar notificación a un dispositivo específico
   */
  async sendToDevice(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<string | null> {
    try {
      const message: admin.messaging.Message = {
        token,
        notification: { title, body },
        data: data ?? {},
        android: {
          priority: 'high',
          notification: {
            channelId: 'syncronize_default',
            priority: 'high',
            defaultSound: true,
          },
        },
        apns: {
          payload: {
            aps: {
              alert: { title, body },
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      return response;
    } catch (error: any) {
      console.error(`[Firebase] Error sending to device: ${error.message}`);
      // Token inválido o expirado
      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered'
      ) {
        return null; // Señal para desactivar el token
      }
      throw error;
    }
  }

  /**
   * Enviar notificación a múltiples dispositivos
   */
  async sendToDevices(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<string[]> {
    if (tokens.length === 0) return [];

    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: { title, body },
      data: data ?? {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'syncronize_default',
          priority: 'high',
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Recoger tokens fallidos para desactivar
    const failedTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          failedTokens.push(tokens[idx]);
        }
      }
    });

    return failedTokens;
  }
}
