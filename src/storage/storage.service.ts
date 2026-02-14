import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryProvider } from './providers/cloudinary.provider';
import { ContaboProvider } from './providers/contabo.provider';
import { IStorageProvider } from './interfaces/storage-provider.interface';
import {
  ProveedorStorage,
  TipoArchivo,
  EntidadTipo,
  CategoriaArchivo,
} from '@prisma/client';
import * as path from 'path';

interface UploadArchivoOptions {
  empresaId: string;
  file: Express.Multer.File;
  entidadTipo?: EntidadTipo;
  entidadId?: string;
  categoria?: CategoriaArchivo;
  orden?: number;
  subidoPor?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private providers: Map<ProveedorStorage, IStorageProvider> = new Map();
  private defaultProvider: ProveedorStorage;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private cloudinaryProvider: CloudinaryProvider,
    private contaboProvider: ContaboProvider,
  ) {
    // Inicializar mapa de providers
    this.providers.set(ProveedorStorage.CLOUDINARY, cloudinaryProvider);
    this.providers.set(ProveedorStorage.CONTABO, contaboProvider);

    // Proveedor por defecto desde configuración
    const defaultProviderStr =
      this.configService.get<string>('DEFAULT_STORAGE_PROVIDER') ||
      'CLOUDINARY';
    this.defaultProvider =
      ProveedorStorage[defaultProviderStr] || ProveedorStorage.CLOUDINARY;

    this.logger.log(`Proveedor de storage por defecto: ${this.defaultProvider}`);
  }

  /**
   * Sube un archivo y guarda su metadata en la BD
   */
  async uploadArchivo(options: UploadArchivoOptions) {
    const { empresaId, file, entidadTipo, entidadId, categoria, orden, subidoPor } = options;

    // Validar archivo
    this.validateFile(file);

    // Obtener proveedor (por empresa o usar default)
    const proveedor = await this.getProveedorForEmpresa(empresaId);
    const provider = this.providers.get(proveedor);

    if (!provider) {
      throw new BadRequestException(`Proveedor ${proveedor} no disponible`);
    }

    try {
      // Generar ID único para el archivo
      const fileId = this.generateFileId();
      const extension = path.extname(file.originalname).toLowerCase();

      // Subir archivo al proveedor
      const result = await provider.upload(file.buffer, {
        empresaId,
        fileId,
        mimeType: file.mimetype,
        folder: this.getFolderPath(empresaId, entidadTipo),
      });

      // Determinar tipo de archivo
      const tipoArchivo = this.getTipoArchivo(file.mimetype);

      // Guardar metadata en la BD
      const archivo = await this.prisma.archivo.create({
        data: {
          empresaId,
          nombreOriginal: file.originalname,
          nombreAlmacenado: fileId + extension,
          url: result.url,
          urlThumbnail: result.urlThumbnail,
          tipoArchivo,
          mimeType: file.mimetype,
          extension: extension.replace('.', ''),
          entidadTipo,
          entidadId,
          varianteId: entidadTipo === EntidadTipo.PRODUCTO_VARIANTE ? entidadId : undefined,
          categoria,
          orden,
          proveedor,
          proveedorId: result.proveedorId,
          tamanoBytes: file.size,
          ancho: result.ancho,
          alto: result.alto,
          subidoPor,
        },
      });

      this.logger.log(
        `Archivo creado en BD: ${archivo.id} (${archivo.nombreOriginal})`,
      );

      return archivo;
    } catch (error) {
      this.logger.error(`Error al subir archivo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Elimina un archivo físicamente y de la BD
   */
  async deleteArchivo(archivoId: string, empresaId: string) {
    const archivo = await this.prisma.archivo.findFirst({
      where: { id: archivoId, empresaId },
    });

    if (!archivo) {
      throw new NotFoundException('Archivo no encontrado');
    }

    const provider = this.providers.get(archivo.proveedor);

    if (!provider) {
      throw new BadRequestException(`Proveedor ${archivo.proveedor} no disponible`);
    }

    try {
      // Eliminar del storage
      await provider.delete(archivo.proveedorId);

      // Soft delete en BD
      await this.prisma.archivo.update({
        where: { id: archivoId },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
      });

      this.logger.log(`Archivo eliminado: ${archivoId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error al eliminar archivo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtiene archivos de una entidad
   */
  async getArchivosByEntidad(
    empresaId: string,
    entidadTipo: EntidadTipo,
    entidadId: string,
  ) {
    return await this.prisma.archivo.findMany({
      where: {
        empresaId,
        entidadTipo,
        entidadId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
    });
  }

  /**
   * Migra archivos de un proveedor a otro
   */
  async migrateToProvider(
    empresaId: string,
    targetProvider: ProveedorStorage,
  ) {
    const archivos = await this.prisma.archivo.findMany({
      where: {
        empresaId,
        proveedor: { not: targetProvider },
        isActive: true,
        deletedAt: null,
      },
    });

    this.logger.log(
      `Iniciando migración de ${archivos.length} archivos a ${targetProvider}`,
    );

    let migrados = 0;
    let errores = 0;

    for (const archivo of archivos) {
      try {
        // Descargar del proveedor actual
        const fileBuffer = await this.downloadFile(archivo);

        // Subir al nuevo proveedor
        const newProvider = this.providers.get(targetProvider);
        const result = await newProvider.upload(fileBuffer, {
          empresaId,
          fileId: archivo.nombreAlmacenado.replace(path.extname(archivo.nombreAlmacenado), ''),
          mimeType: archivo.mimeType,
          folder: this.getFolderPath(empresaId, archivo.entidadTipo),
        });

        // Actualizar BD
        await this.prisma.archivo.update({
          where: { id: archivo.id },
          data: {
            url: result.url,
            urlThumbnail: result.urlThumbnail,
            proveedor: targetProvider,
            proveedorId: result.proveedorId,
          },
        });

        // Eliminar del proveedor anterior
        const oldProvider = this.providers.get(archivo.proveedor);
        await oldProvider.delete(archivo.proveedorId);

        migrados++;
        this.logger.log(`Archivo migrado: ${archivo.id}`);
      } catch (error) {
        errores++;
        this.logger.error(
          `Error al migrar archivo ${archivo.id}: ${error.message}`,
        );
      }
    }

    return { total: archivos.length, migrados, errores };
  }

  // Métodos auxiliares

  private validateFile(file: Express.Multer.File) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('El archivo excede el tamaño máximo de 10MB');
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/mpeg',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de archivo no permitido');
    }
  }

  private getTipoArchivo(mimeType: string): TipoArchivo {
    if (mimeType.startsWith('image/')) return TipoArchivo.IMAGEN;
    if (mimeType.startsWith('video/')) return TipoArchivo.VIDEO;
    if (mimeType === 'application/pdf') return TipoArchivo.PDF;
    if (
      mimeType.includes('excel') ||
      mimeType.includes('spreadsheet')
    )
      return TipoArchivo.EXCEL;
    if (mimeType.includes('word') || mimeType.includes('document'))
      return TipoArchivo.WORD;
    if (mimeType.startsWith('audio/')) return TipoArchivo.AUDIO;
    if (mimeType.includes('zip') || mimeType.includes('compressed'))
      return TipoArchivo.COMPRIMIDO;

    return TipoArchivo.OTRO;
  }

  private getFolderPath(
    empresaId: string,
    entidadTipo?: EntidadTipo,
  ): string {
    if (!entidadTipo) return `${empresaId}/archivos`;
    return `${empresaId}/${entidadTipo.toLowerCase()}s`;
  }

  private generateFileId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private async getProveedorForEmpresa(
    empresaId: string,
  ): Promise<ProveedorStorage> {
    // Por ahora usar proveedor por defecto
    // En el futuro, podría ser configurable por empresa
    return this.defaultProvider;
  }

  private async downloadFile(archivo: any): Promise<Buffer> {
    const response = await fetch(archivo.url);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
