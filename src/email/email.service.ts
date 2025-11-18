import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private readonly configService: ConfigService) { }

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
    this.logger.warn('No email configuration found. Emails will be logged instead of sent.');
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
      this.logger.log(`Email service initialized successfully - Connected to ${host}:${port}`);
    } else {
      this.logger.warn('Connection SMTP verified but not successful');
    }
  } catch (error) {
    this.logger.error(`Failed to verify SMTP connection to ${host}:${port}: ${error.message}`);
    this.logger.warn('Email service will continue but emails may fail. Will retry on send.');
  }

  if (nodeEnv !== 'development') {
    this.logger.log(`Email service initialized for ${host}:${port} (full verify done)`);
  }
}

private async verifyConnection(): Promise<boolean> {
  try {
    const isConnected = await this.transporter.verify();
    // this.isConnected = isConnected;  // Agrega private isConnected = false; al class
    // this.lastHealthCheck = new Date();  // private lastHealthCheck: Date;
    if (isConnected) {
      this.logger.log('✅ Conexión SMTP verificada exitosamente');
    } else {
      this.logger.warn('⚠️ Conexión SMTP no pudo verificarse');
    }
    return isConnected;
  } catch (error) {
    this.logger.error('❌ Error verificando conexión SMTP:', error.message);
    // this.isConnected = false;
    // this.lastHealthCheck = new Date();
    return false;
  }
}

  /**
   * Enviar email genérico
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
  console.log('Attempting send to:', options.to, 'from:', this.configService.get('EMAIL_USER'));
  const requestId = this.generateRequestId();  // Agrega método abajo
  this.logger.log(`📧 [${requestId}] Iniciando envío de email a: ${options.to}`);

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
      this.logger.log('Email would be sent:');
      this.logger.log(JSON.stringify(options, null, 2));
      return true;
    }

    const info = await this.transporter.sendMail({
      from: this.configService.get('EMAIL_USER'),
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      headers: {  // Opcional, como en working
        'X-Request-ID': requestId,
      },
    });

    this.logger.log(`✅ [${requestId}] Email sent successfully to ${options.to}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    this.logger.error(`❌ [${requestId}] Failed to send email to ${options.to}: ${error.message}`);
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
    // Para reset de contraseña, sí queremos que vaya al frontend con el formulario
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${resetToken}`;

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
