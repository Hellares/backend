import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { AppLoggerService } from '../common/logger/logger.service';

export interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger: AppLoggerService;
  private transporter: Transporter;

  constructor(
    private readonly configService: ConfigService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(EmailService.name);
  }

  async onModuleInit() {
    await this.initializeTransporter();
  }

 private async initializeTransporter() {
  const host = this.configService.get<string>('EMAIL_HOST');
  const port = this.configService.get<number>('EMAIL_PORT', 587);
  const user = this.configService.get<string>('EMAIL_USER');
  const pass = this.configService.get<string>('EMAIL_PASS');
  // const secure = port === 465;
  const secure = this.configService.get<string>('EMAIL_SECURE') === 'true';

  if (!host || !user) {
    this.logger.warn('No email configuration found. Emails will be logged instead of sent.', {
      host: host || 'not set',
      user: user ? 'set' : 'not set',
    });
    this.transporter = null;
    return;
  }

  this.transporter = nodemailer.createTransport({
    host,
    port,
    secure,  // false para 587 (STARTTLS), true para 465 (SMTPS)
    auth: { user, pass },
    tls: { rejectUnauthorized: false },  // Simple, como en working
    connectionTimeout: 10000,  // 10s
    greetingTimeout: 5000,     // 5s
    socketTimeout: 30000,      // 30s
    logger: this.configService.get('NODE_ENV') === 'development',  // Solo dev
    debug: this.configService.get('NODE_ENV') === 'development',
  });

  // Siempre verifica, incluso en prod (como en working)
  const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
  try {
    const isConnected = await this.transporter.verify();
    if (isConnected) {
      this.logger.info('Email service initialized successfully', { host, port, secure });
    } else {
      this.logger.warn('Connection SMTP verified but not successful', { host, port });
    }
  } catch (error) {
    this.logger.error('Failed to verify SMTP connection', error.stack, { host, port });
    this.logger.warn('Email service will continue but emails may fail. Will retry on send.');
  }

  if (nodeEnv !== 'development') {
    this.logger.info('Email service initialized', { host, port, nodeEnv });
  }
}

private async verifyConnection(): Promise<boolean> {
  try {
    const isConnected = await this.transporter.verify();
    // this.isConnected = isConnected;  // Agrega private isConnected = false; al class
    // this.lastHealthCheck = new Date();  // private lastHealthCheck: Date;
    if (isConnected) {
      this.logger.success('Conexión SMTP verificada exitosamente');
    } else {
      this.logger.warn('Conexión SMTP no pudo verificarse');
    }
    return isConnected;
  } catch (error) {
    this.logger.error('Error verificando conexión SMTP', error.stack);
    // this.isConnected = false;
    // this.lastHealthCheck = new Date();
    return false;
  }
}

  /**
   * Enviar email genérico
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
  console.log('Attempting send to:', options.to, 'from:', this.configService.get('EMAIL_FROM'));
  const requestId = this.generateRequestId();  // Agrega método abajo
  this.logger.info('Iniciando envío de email', {
    requestId,
    to: options.to,
    subject: options.subject,
  });

  try {
    // Chequea y re-verifica conexión
    // if (!this.isConnected) {
    //   this.logger.warn(`🔄 [${requestId}] Conexión no verificada, reconectando...`);
      await this.verifyConnection();
    //   if (!this.isConnected) {
    //     throw new Error('No hay conexión SMTP disponible');
    //   }
    // }

    if (!this.transporter) {
      this.logger.info('Email would be sent (transporter not configured)', {
        requestId,
        to: options.to,
        subject: options.subject,
      });
      return true;
    }

    const info = await this.transporter.sendMail({
      from: this.configService.get('EMAIL_FROM'),
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      headers: {  // Opcional, como en working
        'X-Request-ID': requestId,
      },
    });

    this.logger.success('Email sent successfully', {
      requestId,
      to: options.to,
      messageId: info.messageId,
    });
    return true;
  } catch (error) {
    this.logger.error('Failed to send email', error.stack, {
      requestId,
      to: options.to,
      subject: options.subject,
    });
    return false;
  }
}

private isConnectionError(error: any): boolean {
  const connectionErrors = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'SMTP', 'timeout', 'connection'];
  const errorMessage = error.message?.toLowerCase() || '';
  return connectionErrors.some(err => errorMessage.includes(err.toLowerCase()));
}

private generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `email_${timestamp}_${random}`;
}

  /**
   * Enviar email de verificación
   */
  async sendVerificationEmail(email: string, verificationToken: string, nombres: string): Promise<boolean> {
    const backendUrl = this.configService.get<string>('BACKEND_URL', 'http://localhost:3001');
    const verificationUrl = `${backendUrl}/api/auth/verify-email/${verificationToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #4F46E5;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f9f9f9;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .button {
              display: inline-block;
              background-color: #4F46E5;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              color: #666;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Verificación de Email</h1>
            </div>
            <div class="content">
              <p>Hola <strong>${nombres}</strong>,</p>
              <p>Gracias por registrarte en nuestra plataforma. Para completar tu registro, por favor verifica tu dirección de email haciendo clic en el siguiente botón:</p>
              <div style="text-align: center;">
                <a href="${verificationUrl}" class="button">Verificar Email</a>
              </div>
              <p>O copia y pega este enlace en tu navegador:</p>
              <p style="word-break: break-all; color: #4F46E5;">${verificationUrl}</p>
              <p><strong>Este enlace expirará en 24 horas.</strong></p>
              <p>Si no solicitaste este registro, puedes ignorar este mensaje.</p>
            </div>
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
Hola ${nombres},

Gracias por registrarte. Para verificar tu email, visita el siguiente enlace:

${verificationUrl}

Este enlace expirará en 24 horas.

Si no solicitaste este registro, ignora este mensaje.
    `;

    return this.sendEmail({
      to: email,
      subject: 'Verifica tu dirección de email',
      html,
      text,
    });
  }

  /**
   * Enviar email de recuperación de contraseña
   */
  async sendPasswordResetEmail(email: string, resetToken: string, nombres: string): Promise<boolean> {
    // Sin frontend web propio: el link apunta a la página HTML inline servida
    // por el backend (`GET /auth/reset-password`), que contiene el formulario
    // y llama al POST /auth/reset-password. Mismo patrón que verify-email.
    const backendUrl = this.configService.get<string>('BACKEND_URL', 'http://localhost:3000');
    const resetUrl = `${backendUrl}/auth/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #DC2626;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f9f9f9;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .button {
              display: inline-block;
              background-color: #DC2626;
              color: white;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
            }
            .warning {
              background-color: #FEF3C7;
              border-left: 4px solid #F59E0B;
              padding: 10px;
              margin: 15px 0;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              color: #666;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Recuperación de Contraseña</h1>
            </div>
            <div class="content">
              <p>Hola <strong>${nombres}</strong>,</p>
              <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Restablecer Contraseña</a>
              </div>
              <p>O copia y pega este enlace en tu navegador:</p>
              <p style="word-break: break-all; color: #DC2626;">${resetUrl}</p>
              <div class="warning">
                <strong>⚠️ Importante:</strong> Este enlace expirará en 1 hora por razones de seguridad.
              </div>
              <p><strong>Si no solicitaste este cambio, ignora este mensaje.</strong> Tu contraseña no será modificada.</p>
            </div>
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
Hola ${nombres},

Recibimos una solicitud para restablecer la contraseña de tu cuenta.

Para restablecer tu contraseña, visita el siguiente enlace:

${resetUrl}

Este enlace expirará en 1 hora.

Si no solicitaste este cambio, ignora este mensaje. Tu contraseña no será modificada.
    `;

    return this.sendEmail({
      to: email,
      subject: 'Restablece tu contraseña',
      html,
      text,
    });
  }

  /**
   * Notificación al email anterior cuando el usuario cambia su email.
   * Permite que el dueño legítimo detecte un cambio que él no hizo y
   * actúe rápido (recuperar contraseña, contactar soporte). El correo
   * sale al `previousEmail`, no al nuevo.
   */
  async sendEmailChangedNotification(
    previousEmail: string,
    newEmail: string,
    nombres: string,
  ): Promise<boolean> {
    const maskedNew = this.maskEmail(newEmail);
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; color: #333; line-height: 1.55; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background:#0f172a; color:#fff; padding:18px; border-radius:6px 6px 0 0; text-align:center; }
            .content { background:#f9fafb; padding:24px; border-radius: 0 0 6px 6px; }
            .alert { background:#fef3c7; border-left:4px solid #f59e0b; padding:12px; margin:14px 0; font-size:13px; }
            .footer { text-align:center; margin-top:18px; color:#64748b; font-size:12px; }
            .new { font-family: monospace; background:#fff; padding:6px 10px; border:1px dashed #cbd5e1; border-radius:6px; display:inline-block; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h2 style="margin:0">Cambio de email en tu cuenta</h2></div>
            <div class="content">
              <p>Hola <strong>${nombres}</strong>,</p>
              <p>Te avisamos que el email de inicio de sesión de tu cuenta de Syncronize fue cambiado.</p>
              <p>Nuevo email: <span class="new">${maskedNew}</span></p>
              <div class="alert">
                <strong>¿No fuiste tú?</strong> Cambia tu contraseña inmediatamente y contacta a soporte. Mientras el nuevo email no esté verificado, este correo sigue siendo el contacto principal de tu cuenta.
              </div>
              <p style="font-size:12px; color:#475569;">Este es un mensaje informativo. No respondas a este correo.</p>
            </div>
            <div class="footer">Syncronize · Plataforma SaaS</div>
          </div>
        </body>
      </html>
    `;
    const text = `Hola ${nombres},

El email de inicio de sesión de tu cuenta de Syncronize fue cambiado.
Nuevo email: ${maskedNew}

Si no fuiste tú, cambia tu contraseña y contacta a soporte de inmediato.

Syncronize`;
    return this.sendEmail({
      to: previousEmail,
      subject: '⚠️ Tu email fue cambiado en Syncronize',
      html,
      text,
    });
  }

  /**
   * Oculta parcialmente un email para mostrarlo en notificaciones de
   * seguridad sin filtrar el destino completo. Ej: "fulano@gmail.com" →
   * "f****o@gmail.com".
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    if (local.length <= 2) return `${local[0]}*@${domain}`;
    return `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}@${domain}`;
  }

  /**
   * Enviar email de bienvenida (opcional)
   */
  async sendWelcomeEmail(email: string, nombres: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background-color: #10B981;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: #f9f9f9;
              padding: 30px;
              border-radius: 0 0 5px 5px;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              color: #666;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>¡Bienvenido!</h1>
            </div>
            <div class="content">
              <p>Hola <strong>${nombres}</strong>,</p>
              <p>¡Tu email ha sido verificado exitosamente!</p>
              <p>Gracias por unirte a nuestra plataforma. Estamos emocionados de tenerte con nosotros.</p>
              <p>Ahora puedes acceder a todas las funcionalidades de tu cuenta.</p>
              <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
            </div>
            <div class="footer">
              <p>Este es un mensaje automático, por favor no respondas a este email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
Hola ${nombres},

¡Tu email ha sido verificado exitosamente!

Gracias por unirte a nuestra plataforma. Ahora puedes acceder a todas las funcionalidades de tu cuenta.

Si tienes alguna pregunta, no dudes en contactarnos.
    `;

    return this.sendEmail({
      to: email,
      subject: '¡Bienvenido! Tu email ha sido verificado',
      html,
      text,
    });
  }

  
}
