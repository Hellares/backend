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
import { PlanLimitsService } from '../common/services/plan-limits.service';
import {
  ProveedorStorage,
  TipoArchivo,
  EntidadTipo,
  CategoriaArchivo,
} from '@prisma/client';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');
interface UploadArchivoOptions {
  empresaId: string;
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
  entidadTipo?: EntidadTipo;
  entidadId?: string;
  categoria?: CategoriaArchivo;
  orden?: number;
  subidoPor?: string;
}

interface MediaProcessorResult {
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  originalSize: number;
  processedSize: number;
  reduction: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private providers: Map<ProveedorStorage, IStorageProvider> = new Map();
  private defaultProvider: ProveedorStorage;
  private mediaProcessorUrl: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private cloudinaryProvider: CloudinaryProvider,
    private contaboProvider: ContaboProvider,
    private planLimitsService: PlanLimitsService,
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

    // Media Processor URL
    this.mediaProcessorUrl =
      this.configService.get<string>('MEDIA_PROCESSOR_URL') || 'http://localhost:4000';

    this.logger.log(`Proveedor de storage por defecto: ${this.defaultProvider}`);
    this.logger.log(`Media Processor: ${this.mediaProcessorUrl}`);
  }

  /**
   * Sube un archivo y guarda su metadata en la BD
   */
  async uploadArchivo(options: UploadArchivoOptions) {
    const { empresaId, file, entidadTipo, entidadId, categoria, orden, subidoPor } = options;

    // Validar archivo
    this.validateFile(file);

    // Validar límite de almacenamiento del plan
    await this.planLimitsService.checkStorageLimit(empresaId, file.size);

    // Obtener proveedor (por empresa o usar default)
    const proveedor = await this.getProveedorForEmpresa(empresaId);
    const provider = this.providers.get(proveedor);

    if (!provider) {
      throw new BadRequestException(`Proveedor ${proveedor} no disponible`);
    }

    try {
      // Generar ID único para el archivo
      const fileId = this.generateFileId();
      const tipoArchivo = this.getTipoArchivo(file.mimetype);

      // Procesar imagen si es necesario
      let fileBuffer = file.buffer;
      let fileMimeType = file.mimetype;
      let fileSize = file.size;
      let processedWidth: number | undefined;
      let processedHeight: number | undefined;

      let thumbnailBuffer: Buffer | null = null;
      let thumbnailMimeType = 'image/jpeg';

      let imageVersions: Record<string, string> | null = null;

      if (tipoArchivo === TipoArchivo.IMAGEN) {
        const preset = this.getPresetForCategoria(categoria);
        // Procesar imagen principal + thumbnail + medium en paralelo
        const [processed, thumb, medium] = await Promise.all([
          this.processImage(fileBuffer, file.originalname, preset),
          this.processImage(fileBuffer, file.originalname, 'thumbnail'),
          this.processImage(fileBuffer, file.originalname, 'medium'),
        ]);
        if (processed) {
          fileBuffer = processed.buffer;
          fileMimeType = processed.mimeType;
          fileSize = processed.processedSize;
          processedWidth = processed.width;
          processedHeight = processed.height;
          this.logger.log(
            `Imagen procesada: ${file.originalname} | ${processed.reduction} reduccion`,
          );
        }
        if (thumb) {
          thumbnailBuffer = thumb.buffer;
          thumbnailMimeType = thumb.mimeType;
        }
        // Subir versión medium en background
        if (medium) {
          const mediumExt = this.getExtensionFromMime(medium.mimeType) || '.jpg';
          const mediumProvider = this.providers.get(proveedor);
          try {
            const mediumResult = await mediumProvider.upload(medium.buffer, {
              empresaId,
              fileId: fileId + '-md',
              mimeType: medium.mimeType,
              folder: this.getFolderPath(empresaId, entidadTipo) + '/medium',
            });
            imageVersions = { medium: mediumResult.url };
          } catch {
            // No es crítico
          }
        }
      } else if (tipoArchivo === TipoArchivo.VIDEO) {
        // Solo generar thumbnail (sync), compresión se hace en background después de subir
        const thumb = await this.processVideoThumbnail(fileBuffer, file.originalname, file.mimetype);
        if (thumb) {
          thumbnailBuffer = thumb.buffer;
          thumbnailMimeType = thumb.mimeType;
          this.logger.log(`Video thumbnail generado: ${file.originalname}`);
        }
      }

      // Determinar extensión según el mime resultante
      const extension = this.getExtensionFromMime(fileMimeType) || path.extname(file.originalname).toLowerCase();

      // Subir archivo al proveedor (con fallback)
      let result: any;
      let proveedorUsado = proveedor;

      try {
        result = await provider.upload(fileBuffer, {
          empresaId,
          fileId,
          mimeType: fileMimeType,
          folder: this.getFolderPath(empresaId, entidadTipo),
        });
      } catch (uploadError: any) {
        // Fallback al otro proveedor
        const fallbackProveedor = proveedor === ProveedorStorage.CONTABO
          ? ProveedorStorage.CLOUDINARY
          : ProveedorStorage.CONTABO;
        const fallbackProvider = this.providers.get(fallbackProveedor);

        if (fallbackProvider) {
          this.logger.warn(
            `${proveedor} falló (${uploadError.message}), usando fallback: ${fallbackProveedor}`,
          );
          result = await fallbackProvider.upload(fileBuffer, {
            empresaId,
            fileId,
            mimeType: fileMimeType,
            folder: this.getFolderPath(empresaId, entidadTipo),
          });
          proveedorUsado = fallbackProveedor;
        } else {
          throw uploadError;
        }
      }

      // Subir thumbnail si se generó
      let thumbnailUrl: string | undefined;
      if (thumbnailBuffer) {
        try {
          const thumbExt = this.getExtensionFromMime(thumbnailMimeType) || '.jpg';
          const thumbProvider = this.providers.get(proveedorUsado);
          const thumbResult = await thumbProvider.upload(thumbnailBuffer, {
            empresaId,
            fileId: fileId + '-thumb',
            mimeType: thumbnailMimeType,
            folder: this.getFolderPath(empresaId, entidadTipo) + '/thumbnails',
          });
          thumbnailUrl = thumbResult.url;
        } catch (thumbError: any) {
          this.logger.warn(`Error subiendo thumbnail: ${thumbError.message}`);
        }
      }

      // Guardar metadata en la BD
      const archivo = await this.prisma.archivo.create({
        data: {
          empresaId,
          nombreOriginal: file.originalname,
          nombreAlmacenado: fileId + extension,
          url: result.url,
          urlThumbnail: thumbnailUrl || null,
          tipoArchivo,
          mimeType: fileMimeType,
          extension: extension.replace('.', ''),
          entidadTipo: entidadTipo || undefined,
          entidadId: entidadId && entidadId.trim() ? entidadId.trim() : undefined,
          varianteId: entidadTipo === EntidadTipo.PRODUCTO_VARIANTE ? entidadId : undefined,
          categoria,
          orden,
          proveedor: proveedorUsado,
          proveedorId: result.proveedorId,
          tamanoBytes: fileSize,
          ancho: processedWidth ?? result.ancho,
          alto: processedHeight ?? result.alto,
          versiones: imageVersions || undefined,
          subidoPor,
        },
      });

      this.logger.log(
        `Archivo creado en BD: ${archivo.id} (${archivo.nombreOriginal})`,
      );

      // Comprimir video en background (no bloquea la respuesta)
      if (tipoArchivo === TipoArchivo.VIDEO) {
        this.compressVideoInBackground(
          archivo.id,
          empresaId,
          file.buffer,
          file.originalname,
          file.mimetype,
          proveedorUsado,
          entidadTipo,
        ).catch((err) => {
          this.logger.error(`Error en compresión async de video: ${err.message}`);
        });
      }

      return archivo;
    } catch (error: any) {
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

      // Si es video de un producto, limpiar videoUrl del producto
      if (archivo.tipoArchivo === 'VIDEO' && archivo.entidadTipo === 'PRODUCTO' && archivo.entidadId) {
        const producto = await this.prisma.producto.findUnique({
          where: { id: archivo.entidadId },
          select: { videoUrl: true },
        });
        if (producto?.videoUrl === archivo.url) {
          await this.prisma.producto.update({
            where: { id: archivo.entidadId },
            data: { videoUrl: null },
          });
          this.logger.log(`VideoUrl limpiado del producto: ${archivo.entidadId}`);
        }
      }

      this.logger.log(`Archivo eliminado: ${archivoId}`);
      return { success: true };
    } catch (error: any) {
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
      } catch (error: any) {
        errores++;
        this.logger.error(
          `Error al migrar archivo ${archivo.id}: ${error.message}`,
        );
      }
    }

    return { total: archivos.length, migrados, errores };
  }

  // Métodos auxiliares

  private validateFile(file: { mimetype: string; size: number }) {
    const isVideo = file.mimetype.startsWith('video/');
    const maxSize = isVideo ? 80 * 1024 * 1024 : 10 * 1024 * 1024; // 80MB video, 10MB otros
    const label = isVideo ? '80MB' : '10MB';

    if (file.size > maxSize) {
      throw new BadRequestException(`El archivo excede el tamaño máximo de ${label}`);
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/webm',
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

  /**
   * Envía imagen al Media Processor para optimización
   */
  private processImage(
    buffer: Buffer,
    filename: string,
    preset: string,
  ): Promise<MediaProcessorResult | null> {
    return new Promise((resolve) => {
      try {
        const form = new FormData();
        form.append('file', buffer, {
          filename,
          contentType: this.getMimeFromFilename(filename),
        });
        form.append('preset', preset);

        const url = new URL(`${this.mediaProcessorUrl}/process/image`);

        form.submit(url.href, (err, res) => {
          if (err) {
            this.logger.warn(`Media Processor no disponible: ${err.message}`);
            resolve(null);
            return;
          }

          if (res.statusCode !== 200) {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              this.logger.warn(`Media Processor error (${res.statusCode}): ${body}`);
              resolve(null);
            });
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const processedBuffer = Buffer.concat(chunks);
            const headers = res.headers;
            const contentType = (headers['content-type'] as string) || 'image/jpeg';
            const width = parseInt((headers['x-width'] as string) || '0');
            const height = parseInt((headers['x-height'] as string) || '0');
            const originalSize = parseInt((headers['x-original-size'] as string) || '0');
            const reduction = (headers['x-reduction'] as string) || '0%';

            resolve({
              buffer: processedBuffer,
              mimeType: contentType,
              width: width || undefined,
              height: height || undefined,
              originalSize,
              processedSize: processedBuffer.length,
              reduction,
            });
          });
        });
      } catch (error: any) {
        this.logger.warn(
          `Media Processor no disponible, subiendo sin procesar: ${error.message}`,
        );
        resolve(null);
      }
    });
  }

  /**
   * Determina el preset según la categoría del archivo
   */
  private getPresetForCategoria(categoria?: CategoriaArchivo): string {
    if (!categoria) return 'default';
    const presetMap: Record<string, string> = {
      PRINCIPAL: 'producto',
      GALERIA: 'galeria',
      THUMBNAIL: 'thumbnail',
      LOGO: 'logo',
      BANNER: 'banner',
      SPLASH: 'banner',
    };
    return presetMap[categoria] || 'default';
  }

  private getExtensionFromMime(mimeType: string): string | null {
    const map: Record<string, string> = {
      'image/webp': '.webp',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
    };
    return map[mimeType] || null;
  }

  private processVideo(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<MediaProcessorResult | null> {
    return new Promise((resolve) => {
      try {
        const form = new FormData();
        form.append('file', buffer, {
          filename,
          contentType: mimeType,
        });
        form.append('maxWidth', '1280');

        const url = new URL(`${this.mediaProcessorUrl}/process/video`);

        form.submit(url.href, (err, res) => {
          if (err) {
            this.logger.warn(`Media Processor (video) no disponible: ${err.message}`);
            resolve(null);
            return;
          }

          if (res.statusCode !== 200) {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              this.logger.warn(`Media Processor video error (${res.statusCode}): ${body}`);
              resolve(null);
            });
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const processedBuffer = Buffer.concat(chunks);
            const headers = res.headers;
            const contentType = (headers['content-type'] as string) || 'video/mp4';
            const width = parseInt((headers['x-width'] as string) || '0');
            const height = parseInt((headers['x-height'] as string) || '0');
            const originalSize = parseInt((headers['x-original-size'] as string) || '0');
            const reduction = (headers['x-reduction'] as string) || '0%';
            const skipped = headers['x-skipped'] === 'true';

            if (skipped) {
              this.logger.log(`Video ${filename}: compresion no redujo tamaño, subiendo original`);
              resolve(null);
              return;
            }

            resolve({
              buffer: processedBuffer,
              mimeType: contentType,
              width: width || undefined,
              height: height || undefined,
              originalSize,
              processedSize: processedBuffer.length,
              reduction,
            });
          });
        });
      } catch (error: any) {
        this.logger.warn(
          `Media Processor (video) no disponible: ${error.message}`,
        );
        resolve(null);
      }
    });
  }

  /**
   * Comprime video en background y actualiza la URL en BD
   */
  /**
   * Galería multimedia: lista todos los archivos de la empresa
   */
  async getGaleriaEmpresa(options: {
    empresaId: string;
    tipoArchivo?: string;
    entidadTipo?: string;
    page: number;
    limit: number;
    orderBy: 'recientes' | 'antiguos' | 'mayor' | 'menor';
  }) {
    const { empresaId, tipoArchivo, entidadTipo, page, limit, orderBy } = options;

    const where: any = {
      empresaId,
      isActive: true,
      deletedAt: null,
    };

    if (tipoArchivo) where.tipoArchivo = tipoArchivo;
    if (entidadTipo) where.entidadTipo = entidadTipo;

    const orderByMap = {
      recientes: { creadoEn: 'desc' as const },
      antiguos: { creadoEn: 'asc' as const },
      mayor: { tamanoBytes: 'desc' as const },
      menor: { tamanoBytes: 'asc' as const },
    };

    const [archivos, total] = await Promise.all([
      this.prisma.archivo.findMany({
        where,
        select: {
          id: true,
          url: true,
          urlThumbnail: true,
          nombreOriginal: true,
          tipoArchivo: true,
          mimeType: true,
          tamanoBytes: true,
          entidadTipo: true,
          entidadId: true,
          categoria: true,
          ancho: true,
          alto: true,
          creadoEn: true,
        },
        orderBy: orderByMap[orderBy] || { creadoEn: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.archivo.count({ where }),
    ]);

    // Obtener nombres de entidades relacionadas
    const archivosConNombre = await Promise.all(
      archivos.map(async (archivo) => {
        let entidadNombre: string | null = null;

        if (archivo.entidadId && archivo.entidadTipo) {
          try {
            if (archivo.entidadTipo === 'PRODUCTO' || archivo.entidadTipo === 'PRODUCTO_VARIANTE') {
              const producto = await this.prisma.producto.findUnique({
                where: { id: archivo.entidadId },
                select: { nombre: true },
              });
              entidadNombre = producto?.nombre || null;
            } else if (archivo.entidadTipo === 'SERVICIO') {
              const servicio = await this.prisma.servicio.findUnique({
                where: { id: archivo.entidadId },
                select: { nombre: true },
              });
              entidadNombre = servicio?.nombre || null;
            } else if (archivo.entidadTipo === 'EMPRESA') {
              entidadNombre = 'Empresa';
            }
          } catch {
            // Ignorar si la entidad no existe
          }
        }

        return { ...archivo, entidadNombre };
      }),
    );

    return {
      data: archivosConNombre,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Estadísticas de almacenamiento
   */
  async getGaleriaStats(empresaId: string) {
    const [totalArchivos, porTipo, totalBytes] = await Promise.all([
      this.prisma.archivo.count({
        where: { empresaId, isActive: true, deletedAt: null },
      }),
      this.prisma.archivo.groupBy({
        by: ['tipoArchivo'],
        where: { empresaId, isActive: true, deletedAt: null },
        _count: true,
        _sum: { tamanoBytes: true },
      }),
      this.prisma.archivo.aggregate({
        where: { empresaId, isActive: true, deletedAt: null },
        _sum: { tamanoBytes: true },
      }),
    ]);

    // Obtener límite del plan
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planSuscripcion: {
          select: { limiteAlmacenamientoMB: true, nombre: true },
        },
      },
    });

    const limiteMB = empresa?.planSuscripcion?.limiteAlmacenamientoMB;
    const usadoBytes = Number(totalBytes._sum.tamanoBytes || 0);

    return {
      totalArchivos,
      usadoMB: Math.round(usadoBytes / (1024 * 1024)),
      usadoBytes,
      limiteMB,
      plan: empresa?.planSuscripcion?.nombre,
      porTipo: porTipo.map((t) => ({
        tipo: t.tipoArchivo,
        cantidad: t._count,
        bytes: Number(t._sum.tamanoBytes || 0),
        mb: Math.round(Number(t._sum.tamanoBytes || 0) / (1024 * 1024)),
      })),
    };
  }

  private async compressVideoInBackground(
    archivoId: string,
    empresaId: string,
    originalBuffer: Buffer,
    filename: string,
    mimeType: string,
    proveedor: ProveedorStorage,
    entidadTipo?: EntidadTipo,
  ) {
    this.logger.log(`🎬 Compresión async iniciada: ${filename}`);

    const processed = await this.processVideo(originalBuffer, filename, mimeType);
    if (!processed) {
      this.logger.log(`🎬 Video ${filename}: sin compresión necesaria`);
      return;
    }

    // Obtener archivo actual para reusar el mismo key (misma URL)
    const archivoActual = await this.prisma.archivo.findUnique({
      where: { id: archivoId },
    });
    if (!archivoActual) return;

    // Sobreescribir en el mismo key para que la URL no cambie
    const provider = this.providers.get(proveedor);
    await provider.upload(processed.buffer, {
      empresaId,
      fileId: archivoActual.nombreAlmacenado.replace(path.extname(archivoActual.nombreAlmacenado), ''),
      mimeType: processed.mimeType,
      folder: this.getFolderPath(empresaId, entidadTipo),
    });

    // Versionar la URL para bustear caches (CDN + cache de video en device).
    // El objeto se sobrescribió en la MISMA key física, así que sin un cambio de
    // URL el edge y el dispositivo seguirían sirviendo la versión cruda (moov al
    // final). Mantenemos la key; solo agregamos un query `?v=` que el storage
    // ignora pero que funciona como cache key distinto en CDN y flutter_cache_manager.
    const version = Date.now().toString(36);
    const baseUrl = archivoActual.url.split('?')[0];
    const versionedUrl = `${baseUrl}?v=${version}`;

    await this.prisma.archivo.update({
      where: { id: archivoId },
      data: {
        url: versionedUrl,
        tamanoBytes: processed.processedSize,
        ancho: processed.width,
        alto: processed.height,
        esOptimizado: true,
      },
    });

    // El marketplace reproduce desde Producto.videoUrl (campo denormalizado), no
    // desde Archivo.url. Propagamos la URL versionada al producto para que el app
    // reciba el cache-bust y baje la versión faststart/optimizada.
    if (entidadTipo === EntidadTipo.PRODUCTO && archivoActual.entidadId) {
      await this.prisma.producto.updateMany({
        where: { id: archivoActual.entidadId, empresaId },
        data: { videoUrl: versionedUrl },
      });
    }

    const reduction = processed.reduction;
    this.logger.log(
      `🎬 Video comprimido async: ${filename} | ${reduction} reduccion | url versionada ?v=${version}`,
    );
  }

  private processVideoThumbnail(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<MediaProcessorResult | null> {
    return new Promise((resolve) => {
      try {
        const form = new FormData();
        form.append('file', buffer, {
          filename,
          contentType: mimeType,
        });
        form.append('width', '480');
        form.append('height', '360');

        const url = new URL(`${this.mediaProcessorUrl}/process/video/thumbnail`);

        form.submit(url.href, (err, res) => {
          if (err) {
            this.logger.warn(`Media Processor (video thumb) no disponible: ${err.message}`);
            resolve(null);
            return;
          }

          if (res.statusCode !== 200) {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              this.logger.warn(`Media Processor video thumb error (${res.statusCode}): ${body}`);
              resolve(null);
            });
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const processedBuffer = Buffer.concat(chunks);
            const contentType = (res.headers['content-type'] as string) || 'image/jpeg';

            resolve({
              buffer: processedBuffer,
              mimeType: contentType,
              originalSize: buffer.length,
              processedSize: processedBuffer.length,
              reduction: '0%',
            });
          });
        });
      } catch (error: any) {
        this.logger.warn(`Media Processor (video thumb) error: ${error.message}`);
        resolve(null);
      }
    });
  }

  private getMimeFromFilename(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return map[ext] || 'application/octet-stream';
  }
}
