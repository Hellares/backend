import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CategoriaArchivo, EntidadTipo } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Fotos de una venta: cómo se vendió el producto y cómo se entregó.
 *
 * Son EVIDENCIA interna. Sirven de respaldo ante un reclamo —"así te lo
 * entregué"— así que no viajan al comprobante ni al ticket del cliente.
 *
 * 🔴 No usan `POST /storage/upload`: ese endpoint exige `MANAGE_SETTINGS`, que
 * es de administrador, y quien saca estas fotos es el CAJERO. Es el mismo
 * motivo por el que CxP tiene su propio endpoint para el voucher de Yape.
 *
 * Se apoyan en el `Archivo` polimórfico, que ya tenía `EntidadTipo.VENTA` y
 * `CategoriaArchivo.EVIDENCIA` en el enum: cero migración.
 */
@Injectable()
export class VentaEvidenciaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Sube una foto ANTES de que la venta exista.
   *
   * En el mostrador la foto se saca mientras se cobra, así que se sube en el
   * momento —con `entidadId` en null— y el id vuelve para que viaje en
   * `evidenciaIds` al crear la venta. Subirla recién al confirmar dejaría al
   * cliente esperando frente a la caja mientras sale por datos móviles.
   *
   * 🔴 Si el cajero abandona la venta, el archivo queda HUÉRFANO
   * (`entidadTipo = VENTA` y `entidadId IS NULL`). Es el mismo comportamiento
   * que las imágenes de producto. Se acepta a propósito: pesan poco y esa
   * combinación es exactamente el filtro para limpiarlos después.
   */
  async subir(empresaId: string, usuarioId: string, file: any) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ninguna imagen');
    }
    const archivo = await this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: EntidadTipo.VENTA,
      categoria: CategoriaArchivo.EVIDENCIA,
      subidoPor: usuarioId,
    });
    return {
      archivoId: archivo.id,
      url: archivo.url,
      urlThumbnail: archivo.urlThumbnail ?? null,
    };
  }

  /**
   * Sube y ADJUNTA una foto a una venta que YA existe.
   *
   * La entrega muchas veces pasa horas después del cobro, y ahí es cuando se
   * saca la foto de cómo se entregó.
   */
  async adjuntar(
    empresaId: string,
    ventaId: string,
    usuarioId: string,
    file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ninguna imagen');
    }
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      select: { id: true },
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');

    const archivo = await this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: EntidadTipo.VENTA,
      entidadId: ventaId,
      categoria: CategoriaArchivo.EVIDENCIA,
      subidoPor: usuarioId,
    });
    return {
      archivoId: archivo.id,
      url: archivo.url,
      urlThumbnail: archivo.urlThumbnail ?? null,
    };
  }

  /** Las fotos de una venta, en el orden en que se subieron. */
  async listar(empresaId: string, ventaId: string) {
    const filas = await this.prisma.archivo.findMany({
      where: {
        empresaId,
        entidadTipo: EntidadTipo.VENTA,
        entidadId: ventaId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { creadoEn: 'asc' },
      select: {
        id: true,
        url: true,
        urlThumbnail: true,
        nombreOriginal: true,
        creadoEn: true,
        subidoPor: true,
      },
    });
    return filas.map((f) => ({
      archivoId: f.id,
      url: f.url,
      urlThumbnail: f.urlThumbnail,
      nombreOriginal: f.nombreOriginal,
      creadoEn: f.creadoEn,
      subidoPor: f.subidoPor,
    }));
  }

  /**
   * Saca una foto de la venta. Soft-delete: el archivo sigue en el storage y
   * en la fila, solo deja de listarse. Una evidencia borrada por error no se
   * puede volver a sacar, así que no se destruye.
   */
  async eliminar(empresaId: string, ventaId: string, archivoId: string) {
    const archivo = await this.prisma.archivo.findFirst({
      where: {
        id: archivoId,
        empresaId,
        entidadTipo: EntidadTipo.VENTA,
        entidadId: ventaId,
      },
      select: { id: true },
    });
    if (!archivo) throw new NotFoundException('Imagen no encontrada');

    await this.prisma.archivo.update({
      where: { id: archivoId },
      data: { isActive: false, deletedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Enlaza a la venta recién creada las fotos que se subieron mientras se
   * cobraba. Se llama DENTRO de la transacción de la venta.
   *
   * 🔴 El `where` exige `entidadId: null` y la empresa: sin eso, mandar el id
   * de una foto de OTRA venta se la robaría a esa venta. Los ids que no
   * califican se ignoran en silencio a propósito — la venta ya está cobrada y
   * no se va a tirar abajo porque una foto no enganchó.
   */
  async vincular(
    tx: { archivo: { updateMany: (args: any) => Promise<{ count: number }> } },
    empresaId: string,
    ventaId: string,
    archivoIds: string[],
  ): Promise<number> {
    const ids = [...new Set(archivoIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    const { count } = await tx.archivo.updateMany({
      where: {
        id: { in: ids },
        empresaId,
        entidadTipo: EntidadTipo.VENTA,
        entidadId: null,
        deletedAt: null,
      },
      data: { entidadId: ventaId },
    });
    return count;
  }
}
