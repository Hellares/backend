import { Injectable } from '@nestjs/common';
import { ProveedorFacturacion } from '@prisma/client';
import { FacturacionProvider } from '../facturacion-provider.interface';
import { NubefactProvider } from './nubefact.provider';
import { SyncrofactProvider } from './syncrofact.provider';

/**
 * Proveedores archivados: emitieron comprobantes en el pasado pero ya no
 * aceptan nuevos envíos. Las consultas de lectura (ver PDF/enlace desde BD)
 * siguen funcionando, pero se bloquean reenvío/consulta/anulación con un
 * mensaje claro al usuario.
 *
 * Para "jubilar" un proveedor, agregarlo aquí.
 */
export const PROVEEDORES_ARCHIVADOS: ReadonlySet<ProveedorFacturacion> = new Set([
  ProveedorFacturacion.NUBEFACT,
]);

/**
 * Proveedor por defecto cuando un comprobante no tiene proveedorEmisor
 * grabado (caso legacy). Se asume Nubefact porque los comprobantes históricos
 * fueron emitidos por él.
 */
const PROVEEDOR_DEFAULT_LEGACY: ProveedorFacturacion = ProveedorFacturacion.NUBEFACT;

@Injectable()
export class FacturacionProviderFactory {
  constructor(
    private readonly nubefact: NubefactProvider,
    private readonly syncrofact: SyncrofactProvider,
  ) {}

  /**
   * Resuelve el provider correspondiente al proveedor indicado.
   * Lookup en memoria, O(1), sin BD.
   */
  get(proveedor: ProveedorFacturacion | null | undefined): FacturacionProvider {
    const p = proveedor ?? PROVEEDOR_DEFAULT_LEGACY;
    switch (p) {
      case ProveedorFacturacion.SYNCROFACT:
        return this.syncrofact;
      case ProveedorFacturacion.NUBEFACT:
        return this.nubefact;
      default: {
        const _exhaustive: never = p;
        throw new Error(`Proveedor de facturación no soportado: ${_exhaustive}`);
      }
    }
  }

  /**
   * Un proveedor "archivado" ya no acepta nuevos envíos/anulaciones.
   * Solo lectura de datos históricos.
   */
  isArchivado(proveedor: ProveedorFacturacion | null | undefined): boolean {
    if (!proveedor) return PROVEEDORES_ARCHIVADOS.has(PROVEEDOR_DEFAULT_LEGACY);
    return PROVEEDORES_ARCHIVADOS.has(proveedor);
  }

  /** Mensaje estándar cuando se intenta operar sobre un proveedor archivado */
  mensajeArchivado(proveedor: ProveedorFacturacion): string {
    return `El proveedor ${proveedor} fue deprecado. Emite una Nota de Crédito con el proveedor activo para anular comprobantes históricos.`;
  }
}
