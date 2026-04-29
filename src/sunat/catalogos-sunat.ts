/**
 * Catálogos oficiales SUNAT para Notas de Crédito (catálogo 09) y
 * Notas de Débito (catálogo 10). Source of truth para validación y UI.
 *
 * Referencia: https://cpe.sunat.gob.pe/sites/default/files/inline-files/Catalogo%20de%20codigos.xlsx
 */

export interface MotivoNota {
  codigo: number;
  codigoString: string;
  descripcion: string;
}

export const CATALOGO_09_NOTA_CREDITO: ReadonlyArray<MotivoNota> = [
  { codigo: 1,  codigoString: '01', descripcion: 'Anulación de la operación' },
  { codigo: 2,  codigoString: '02', descripcion: 'Anulación por error en el RUC' },
  { codigo: 3,  codigoString: '03', descripcion: 'Corrección por error en la descripción' },
  { codigo: 4,  codigoString: '04', descripcion: 'Descuento global' },
  { codigo: 5,  codigoString: '05', descripcion: 'Descuento por ítem' },
  { codigo: 6,  codigoString: '06', descripcion: 'Devolución total' },
  { codigo: 7,  codigoString: '07', descripcion: 'Devolución por ítem' },
  { codigo: 8,  codigoString: '08', descripcion: 'Bonificación' },
  { codigo: 9,  codigoString: '09', descripcion: 'Disminución en el valor' },
  { codigo: 10, codigoString: '10', descripcion: 'Otros conceptos' },
  { codigo: 11, codigoString: '11', descripcion: 'Ajustes de operaciones de exportación' },
  { codigo: 12, codigoString: '12', descripcion: 'Ajustes afectos al IVAP' },
];

export const CATALOGO_10_NOTA_DEBITO: ReadonlyArray<MotivoNota> = [
  { codigo: 1,  codigoString: '01', descripcion: 'Intereses por mora' },
  { codigo: 2,  codigoString: '02', descripcion: 'Aumento en el valor' },
  { codigo: 3,  codigoString: '03', descripcion: 'Penalidades / Otros conceptos' },
  { codigo: 10, codigoString: '10', descripcion: 'Ajustes de operaciones de exportación' },
  { codigo: 11, codigoString: '11', descripcion: 'Ajustes afectos al IVAP' },
];

export type TipoNota = 'NOTA_CREDITO' | 'NOTA_DEBITO';

export function getMotivos(tipo: TipoNota): ReadonlyArray<MotivoNota> {
  return tipo === 'NOTA_CREDITO' ? CATALOGO_09_NOTA_CREDITO : CATALOGO_10_NOTA_DEBITO;
}

export function esMotivoValido(tipo: TipoNota, codigo: number): boolean {
  return getMotivos(tipo).some((m) => m.codigo === codigo);
}

export function getMotivo(tipo: TipoNota, codigo: number): MotivoNota | undefined {
  return getMotivos(tipo).find((m) => m.codigo === codigo);
}
