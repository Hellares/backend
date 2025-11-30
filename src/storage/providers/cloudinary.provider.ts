import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
  IStorageProvider,
  UploadOptions,
  UploadResult,
} from '../interfaces/storage-provider.interface';
import * as sharp from 'sharp';

@Injectable()
export class CloudinaryProvider implements IStorageProvider {
  private readonly logger = new Logger(CloudinaryProvider.name);

  constructor(private configService: ConfigService) {
    // Configurar Cloudinary
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async upload(
    file: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    try {
      const folder = options.folder || `${options.empresaId}/archivos`;

      // Subir archivo a Cloudinary
      const result: UploadApiResponse = await new Promise(
        (resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder,
              public_id: options.fileId,
              resource_type: 'auto', // auto-detecta tipo (image, video, raw)
              transformation: options.transformation,
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            },
          );

          uploadStream.end(file);
        },
      );

      this.logger.log(
        `Archivo subido a Cloudinary: ${result.public_id} (${result.bytes} bytes)`,
      );

      // Generar thumbnail si es imagen
      let urlThumbnail: string | undefined;
      if (result.resource_type === 'image') {
        urlThumbnail = cloudinary.url(result.public_id, {
          transformation: [{ width: 200, height: 200, crop: 'fill' }],
        });
      }

      return {
        url: result.secure_url,
        proveedorId: result.public_id,
        urlThumbnail,
        ancho: result.width,
        alto: result.height,
      };
    } catch (error) {
      this.logger.error(`Error al subir archivo a Cloudinary: ${error.message}`);
      throw error;
    }
  }

  async delete(
    proveedorId: string,
    options?: { folder?: string },
  ): Promise<void> {
    try {
      await cloudinary.uploader.destroy(proveedorId);
      this.logger.log(`Archivo eliminado de Cloudinary: ${proveedorId}`);
    } catch (error) {
      this.logger.error(
        `Error al eliminar archivo de Cloudinary: ${error.message}`,
      );
      throw error;
    }
  }

  getUrl(proveedorId: string, transformations?: any): string {
    return cloudinary.url(proveedorId, {
      transformation: transformations,
      secure: true,
    });
  }

  getSignedUrl(proveedorId: string, expiresIn: number): string {
    const timestamp = Math.floor(Date.now() / 1000) + expiresIn;
    return cloudinary.url(proveedorId, {
      sign_url: true,
      type: 'authenticated',
      secure: true,
    });
  }
}
