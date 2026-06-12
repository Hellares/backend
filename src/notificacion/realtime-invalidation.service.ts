import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';

/**
 * Servicio de invalidación de cache en tiempo real vía FCM data-only.
 *
 * Cuando el admin cambia precio, stock o un nivel de precio (Por Mayor,
 * etc.), todos los cajeros conectados a esa empresa reciben un mensaje
 * silencioso por FCM y refrescan su catálogo local. Sin esto, el cajero
 * vería datos viejos hasta el próximo pull-to-refresh manual (o hasta
 * que intente cobrar y reciba un 409 PRECIO_DESACTUALIZADO /
 * STOCK_INSUFICIENTE).
 *
 * El cliente Flutter se suscribe al topic `empresa-${empresaId}` al
 * hacer switch-tenant. Acá enviamos a ese topic.
 *
 * Defensa en capas:
 * 1. Este servicio (FCM ~1-3s) → refresh visual sin que el cajero haga nada.
 * 2. Rechazo server-side 409 (atómico) → captura los casos que FCM perdió.
 * 3. Dialog del cliente → resolución amigable.
 *
 * **Fire-and-forget**: ninguna de las llamadas a este servicio debe
 * romper el flujo principal (la venta, la actualización de precio, etc.).
 * Si FCM falla, se loguea y se sigue. El sistema queda correcto aunque
 * FCM no entregue.
 */
@Injectable()
export class RealtimeInvalidationService {
  private readonly logger = new Logger(RealtimeInvalidationService.name);

  constructor(private readonly firebase: FirebaseAdminService) {}

  /// Topic al que se suscriben todos los clientes de una empresa.
  private topicForEmpresa(empresaId: string): string {
    return `empresa-${empresaId}`;
  }

  /// Sanitiza valores para FCM data: solo acepta strings. Convierte
  /// nulls/undefined a string vacío para no romper el envelope.
  private toStringMap(
    obj: Record<string, string | null | undefined>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v != null) out[k] = String(v);
    }
    return out;
  }

  /// Precio (base o por nivel) o ambos campos relacionados cambiaron
  /// para un producto/sede. Cliente debe invalidar cache de niveles
  /// + refrescar el item en el catálogo.
  notifyPrecioCambiado(args: {
    empresaId: string;
    productoId?: string | null;
    varianteId?: string | null;
    sedeId?: string | null;
  }): void {
    // Fire-and-forget: no await
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'PRECIO_CAMBIADO',
          empresaId: args.empresaId,
          productoId: args.productoId,
          varianteId: args.varianteId,
          sedeId: args.sedeId,
        }),
      )
      .catch((err) => {
        this.logger.warn(`PRECIO_CAMBIADO send failed: ${err?.message}`);
      });
  }

  /// El stock disponible de un producto/sede cambió (venta, transferencia,
  /// merma, ajuste manual). Cliente debe refrescar el item en el catálogo.
  notifyStockCambiado(args: {
    empresaId: string;
    productoId?: string | null;
    varianteId?: string | null;
    sedeId?: string | null;
  }): void {
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'STOCK_CAMBIADO',
          empresaId: args.empresaId,
          productoId: args.productoId,
          varianteId: args.varianteId,
          sedeId: args.sedeId,
        }),
      )
      .catch((err) => {
        this.logger.warn(`STOCK_CAMBIADO send failed: ${err?.message}`);
      });
  }

  /// Un cliente (Persona compartida o su vínculo EmpresaPersona) cambió:
  /// creado, asociado, datos actualizados, desactivado o eliminado.
  ///
  /// Recibe el ARRAY de empresas a notificar: la Persona es global y
  /// compartida entre empresas — cuando sus datos cambian, TODAS las
  /// empresas vinculadas deben invalidar su catálogo local de clientes
  /// (fan-out), no solo la que hizo el cambio.
  notifyClienteCambiado(args: {
    empresaIds: string[];
    clienteEmpresaId?: string | null;
    personaId?: string | null;
  }): void {
    for (const empresaId of new Set(args.empresaIds)) {
      this.firebase
        .sendDataToTopic(
          this.topicForEmpresa(empresaId),
          this.toStringMap({
            tipo: 'CLIENTE_CAMBIADO',
            empresaId,
            clienteEmpresaId: args.clienteEmpresaId,
            personaId: args.personaId,
          }),
        )
        .catch((err) => {
          this.logger.warn(`CLIENTE_CAMBIADO send failed: ${err?.message}`);
        });
    }
  }

  /// Un cliente empresa B2B (ClienteEmpresa o sus contactos) cambió.
  /// A diferencia de la Persona, es per-empresa: sin fan-out.
  notifyClienteEmpresaCambiado(args: {
    empresaId: string;
    clienteEmpresaId?: string | null;
  }): void {
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'CLIENTE_EMPRESA_CAMBIADO',
          empresaId: args.empresaId,
          clienteEmpresaId: args.clienteEmpresaId,
        }),
      )
      .catch((err) => {
        this.logger.warn(
          `CLIENTE_EMPRESA_CAMBIADO send failed: ${err?.message}`,
        );
      });
  }

  /// Los niveles de precio (Por Mayor, Distribuidor, etc.) de un producto
  /// fueron creados/modificados/eliminados. Cliente debe invalidar el
  /// cache local de niveles para que el próximo cálculo en carrito use
  /// la config actual.
  notifyNivelesCambiados(args: {
    empresaId: string;
    productoId?: string | null;
    varianteId?: string | null;
  }): void {
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'NIVELES_CAMBIADOS',
          empresaId: args.empresaId,
          productoId: args.productoId,
          varianteId: args.varianteId,
        }),
      )
      .catch((err) => {
        this.logger.warn(`NIVELES_CAMBIADOS send failed: ${err?.message}`);
      });
  }

  /// Un producto nuevo fue creado. Cliente debe refrescar el catálogo
  /// para incluirlo. Sin esto, los devices que ya tienen `productos_page`
  /// (o el selector de VR/Cotización) abierta no se enteran hasta que
  /// hacen pull-to-refresh o re-navegan; el bump de `actualizadoEn`
  /// del propio create solo es útil cuando el cliente decide pegarle al
  /// server.
  notifyProductoCreado(args: {
    empresaId: string;
    productoId?: string | null;
  }): void {
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'PRODUCTO_CREADO',
          empresaId: args.empresaId,
          productoId: args.productoId,
        }),
      )
      .catch((err) => {
        this.logger.warn(`PRODUCTO_CREADO send failed: ${err?.message}`);
      });
  }

  /// Un producto existente cambió de forma estructural (nombre, descripción,
  /// categoría, marca, isActive, soft delete, restore, variantes, combos,
  /// bulk-update). Cliente debe descartar lastSync y hacer fetch full para
  /// que el backend re-aplique filtros (isActive, deletedAt, etc.) y para
  /// que el producto aparezca/desaparezca/reordene correctamente.
  ///
  /// Si `productoId` es null, es señal de "catálogo masivo cambió" — bulk
  /// upload, importación, etc.
  notifyProductoActualizado(args: {
    empresaId: string;
    productoId?: string | null;
  }): void {
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'PRODUCTO_ACTUALIZADO',
          empresaId: args.empresaId,
          productoId: args.productoId,
        }),
      )
      .catch((err) => {
        this.logger.warn(`PRODUCTO_ACTUALIZADO send failed: ${err?.message}`);
      });
  }

  /// Las imágenes de un producto cambiaron (upload/delete). Cliente debe
  /// refrescar el catálogo para mostrar la nueva URL. Sin esto, el
  /// syncDeltas no detecta el cambio porque `Producto.actualizadoEn`
  /// no se toca al insertar/borrar filas en `Archivo`.
  notifyImagenCambiada(args: {
    empresaId: string;
    productoId?: string | null;
    varianteId?: string | null;
  }): void {
    this.firebase
      .sendDataToTopic(
        this.topicForEmpresa(args.empresaId),
        this.toStringMap({
          tipo: 'IMAGEN_CAMBIADA',
          empresaId: args.empresaId,
          productoId: args.productoId,
          varianteId: args.varianteId,
        }),
      )
      .catch((err) => {
        this.logger.warn(`IMAGEN_CAMBIADA send failed: ${err?.message}`);
      });
  }
}
