import { SyncrofactProveedorConfig } from './syncrofact.types';

/**
 * Mapea la Guía de Remisión interna de Syncronize → payload de la API de
 * Syncrofact (`POST /v1/dispatch-guides`). Syncrofact es el emisor: recibe
 * `referencia_interna` para correlación y asigna la numeración oficial.
 *
 * El contrato (campos planos transportista, conductor y vehiculo_placa, más
 * objetos partida/llegada/destinatario) está validado contra emisiones
 * ACEPTADAS por SUNAT en beta.
 */

/** MotivoTraslado (enum Syncronize) → cod_traslado SUNAT (catálogo 20) */
const MOTIVO_TRASLADO_COD: Record<string, string> = {
  VENTA: '01',
  COMPRA: '02',
  VENTA_CON_ENTREGA_A_TERCEROS: '03',
  TRASLADO_ENTRE_ESTABLECIMIENTOS: '04',
  CONSIGNACION: '05',
  DEVOLUCION: '06',
  RECOJO_BIENES_TRANSFORMADOS: '07',
  IMPORTACION: '08',
  EXPORTACION: '09',
  OTROS: '13',
  VENTA_SUJETA_A_CONFIRMACION: '14',
  TRASLADO_BIENES_TRANSFORMACION: '17',
  TRASLADO_EMISOR_ITINERANTE: '18',
};

/** TipoTransporte (enum Syncronize) → mod_traslado SUNAT */
const MOD_TRASLADO_COD: Record<string, string> = {
  PUBLICO: '01',
  PRIVADO: '02',
};

function toYmd(value: any): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

export class SyncrofactGreMapper {
  /**
   * Construye el body para `POST /v1/dispatch-guides`.
   * @param guia GuiaRemision con relaciones (detalles, vehiculosSecundarios, ...)
   * @param config config de facturación efectiva (incluye proveedorConfig)
   */
  static toDispatchGuideRequest(guia: any, config: any): Record<string, any> {
    const pc: SyncrofactProveedorConfig | undefined | null = config?.proveedorConfig;
    if (!pc?.companyId || !pc?.branchId) {
      throw new Error(
        'Config de Syncrofact (companyId/branchId) no encontrada para esta sede. ' +
          'Verifique que la empresa ya emita comprobantes por Syncrofact.',
      );
    }

    const modTraslado = guia.tipoTransporte ? MOD_TRASLADO_COD[guia.tipoTransporte] : '02';
    const codTraslado = MOTIVO_TRASLADO_COD[guia.motivoTraslado] ?? '01';

    const body: Record<string, any> = {
      company_id: pc.companyId,
      branch_id: pc.branchId,
      // Correlación idempotente: Syncrofact guarda este id y lo expone en /v1/integracion/documentos
      referencia_interna: guia.id,
      // Serie sugerida; Syncrofact asigna el correlativo oficial
      serie: guia.serie || undefined,
      fecha_emision: toYmd(guia.fechaEmision ?? new Date()),
      cod_traslado: codTraslado,
      des_traslado: guia.motivoTrasladoOtrosDescripcion || undefined,
      mod_traslado: modTraslado,
      fecha_traslado: toYmd(guia.fechaInicioTraslado),
      peso_total: Number(guia.pesoBrutoTotal),
      und_peso_total: guia.pesoBrutoUnidadMedida || 'KGM',
      num_bultos: guia.numeroBultos ?? undefined,
      destinatario: {
        tipo_documento: guia.clienteTipoDocumento,
        numero_documento: guia.clienteNumeroDocumento,
        razon_social: guia.clienteDenominacion,
        direccion: guia.clienteDireccion || undefined,
      },
      partida: {
        ubigeo: guia.puntoPartidaUbigeo,
        direccion: guia.puntoPartidaDireccion,
        cod_local: guia.puntoPartidaCodigoEstablecimientoSunat || undefined,
      },
      llegada: {
        ubigeo: guia.puntoLlegadaUbigeo,
        direccion: guia.puntoLlegadaDireccion,
        cod_local: guia.puntoLlegadaCodigoEstablecimientoSunat || undefined,
      },
      detalles: (guia.detalles || []).map((d: any) => ({
        codigo: d.codigo || d.productoId || 'S/C',
        descripcion: d.descripcion,
        unidad: d.unidadMedida || 'NIU',
        cantidad: Number(d.cantidad),
      })),
      observaciones: guia.observaciones || undefined,
      indicadores: guia.sunatEnvioIndicador ? [guia.sunatEnvioIndicador] : undefined,
    };

    if (modTraslado === '01') {
      // Transporte público → transportista (la placa, si se conoce, va en vehiculo_placa)
      body.transportista_tipo_doc = guia.transportistaDocumentoTipo || '6';
      body.transportista_num_doc = guia.transportistaDocumentoNumero;
      body.transportista_razon_social = guia.transportistaDenominacion;
      body.transportista_nro_mtc = guia.transportistaMtc || undefined;
      if (guia.transportistaPlacaNumero) {
        body.vehiculo_placa = guia.transportistaPlacaNumero;
      }
    } else {
      // Transporte privado → conductor + vehículo
      body.conductor_tipo_doc = guia.conductorDocumentoTipo || '1';
      body.conductor_num_doc = guia.conductorDocumentoNumero;
      body.conductor_licencia = guia.conductorNumeroLicencia;
      body.conductor_nombres = guia.conductorNombre;
      body.conductor_apellidos = guia.conductorApellidos;
      body.vehiculo_placa =
        guia.transportistaPlacaNumero || guia.vehiculosSecundarios?.[0]?.placaNumero;
    }

    return body;
  }
}
