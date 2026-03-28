import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  IStorageProvider,
  UploadOptions,
  UploadResult,
} from '../interfaces/storage-provider.interface';

@Injectable()
export class ContaboProvider implements IStorageProvider {
  private readonly logger = new Logger(ContaboProvider.name);
  private s3Client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private configService: ConfigService) {
    const region = this.configService.get<string>('CONTABO_REGION') || 'eu-central-1';
    const endpoint = this.configService.get<string>('CONTABO_ENDPOINT');

    this.bucket = this.configService.get<string>('CONTABO_BUCKET');
    this.publicUrl = this.configService.get<string>('CONTABO_PUBLIC_URL');

    // Configurar cliente S3 para Contabo
    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: this.configService.get<string>('CONTABO_ACCESS_KEY'),
        secretAccessKey: this.configService.get<string>('CONTABO_SECRET_KEY'),
      },
      forcePathStyle: true, // Importante para S3-compatible services
    });
  }

  async upload(
    file: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    try {
      const folder = options.folder || `${options.empresaId}/archivos`;
      const ext = this.getExtension(options.mimeType);
      const key = `${folder}/${options.fileId}${ext}`;

      // Determinar cache según tipo
      const isMedia = options.mimeType.startsWith('image/') || options.mimeType.startsWith('video/');
      const cacheControl = isMedia
        ? 'public, max-age=31536000, immutable' // 1 año para media (los fileId son únicos)
        : 'public, max-age=86400'; // 1 día para documentos

      // Subir archivo principal
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: options.mimeType,
        ACL: 'public-read',
        CacheControl: cacheControl,
      });

      await this.s3Client.send(command);

      this.logger.log(
        `Archivo subido a Contabo: ${key} (${file.length} bytes)`,
      );

      return {
        url: `${this.publicUrl}/${key}`,
        proveedorId: key,
      };
    } catch (error: any) {
      this.logger.error(`Error al subir archivo a Contabo: ${error.message}`);
      throw error;
    }
  }

  async delete(
    proveedorId: string,
    options?: { folder?: string },
  ): Promise<void> {
    try {
      // Eliminar archivo principal
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: proveedorId,
        }),
      );

      // Intentar eliminar thumbnail si existe
      try {
        const thumbnailKey = proveedorId.replace('/archivos/', '/archivos/thumbnails/');
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: thumbnailKey,
          }),
        );
      } catch (error) {
        // Ignorar si el thumbnail no existe
      }

      this.logger.log(`Archivo eliminado de Contabo: ${proveedorId}`);
    } catch (error) {
      this.logger.error(
        `Error al eliminar archivo de Contabo: ${error.message}`,
      );
      throw error;
    }
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'video/mpeg': '.mpeg',
      'application/pdf': '.pdf',
    };
    return map[mimeType] || '';
  }

  getUrl(proveedorId: string, transformations?: any): string {
    // Contabo no tiene transformaciones on-the-fly como Cloudinary
    // Retornar URL pública directa
    return `${this.publicUrl}/${proveedorId}`;
  }

  async getSignedUrl(proveedorId: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: proveedorId,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }
}
