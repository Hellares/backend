/**
 * Acciones posibles al comparar una serie local contra la del proveedor.
 */
export type AccionDiff =
  | 'EN_SINCRONIA'            // misma serie + mismo correlativo
  | 'ACTUALIZAR_CORRELATIVO'  // misma serie, correlativo proveedor > local
  | 'REEMPLAZAR_SERIE'        // serie local != serie proveedor (el proveedor manda)
  | 'CREAR_NUEVA'             // la Sede no tiene serie configurada para este tipo
  | 'CONFLICTO'               // correlativo local > proveedor — requiere intervención
  | 'NO_EMITIBLE';            // la serie local no existe en el proveedor (solo info)

export interface DiffSerie {
  tipoDocumento: string;                     // "01", "03", ...
  tipoDocumentoNombre: string;               // "Factura", "Boleta", ...
  serieLocal: string | null;
  correlativoLocal: number | null;
  serieProveedor: string | null;
  correlativoProveedor: number | null;
  proximoNumeroProveedor: string | null;
  accion: AccionDiff;
  mensaje?: string;                          // detalle para la UI (warnings)
  comprobantesEmitidosLocalmente: number;    // cantidad con serieLocal en BD
}

export interface BranchPreviewInfo {
  branchIdProveedor: string | number;
  codigo: string;
  nombre: string;
  esActualDeLaSede: boolean;                 // matchea con proveedorConfig.branchId
  diffs: DiffSerie[];
}

export interface SincronizacionPreviewResponse {
  empresaId: string;
  sedeId: string | null;
  /** Target emisor socio (multi-RUC); null cuando el target es una sede. */
  emisorId: string | null;
  sedeNombre: string;
  rucEmpresa: string | null;
  /** Emisor EFECTIVO de las series mostradas (sede.rucSede ?? empresa.ruc). */
  rucEmisor: string | null;
  razonSocialEmisor: string | null;
  /** true = la sede consulta con token propio (empresa socio); false = usa
   *  el token global → las series listadas son del emisor PRINCIPAL. */
  credencialesPropias: boolean;
  proveedorActivo: string;
  seriesSincronizadasEn: Date | null;
  branches: BranchPreviewInfo[];
  metadata?: Record<string, any>;            // enviar_email_cliente, etc.
}

export interface ResultadoAplicarSincronizacion {
  aplicados: number;
  omitidos: number;
  rechazados: number;
  sedeId: string;
  branchIdProveedor?: string | number | null;
  cambios: Array<{
    tipoDocumento: string;
    campoSerie: string;
    campoContador: string;
    serieAntes: string | null;
    serieDespues: string;
    correlativoAntes: number | null;
    correlativoDespues: number;
    accion: AccionDiff;
  }>;
  errores: string[];
}
