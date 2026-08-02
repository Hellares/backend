import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface UbigeoFila {
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
}

/** Los nombres traen tildes: `localeCompare` los ordena bien. */
const porNombre = (a: { nombre: string }, b: { nombre: string }) =>
  a.nombre.localeCompare(b.nombre, 'es');

/**
 * Catálogo ÚNICO de ubigeo del Perú (1892 distritos, 196 provincias, 25
 * departamentos). Lo comparten guía de remisión —que lo manda a SUNAT— y el
 * selector de zonas de reparto.
 *
 * Antes había dos archivos y el de guía de remisión estaba defectuoso: 1496
 * distritos, con 376 códigos faltantes repartidos en 121 de 183 provincias
 * (SALAVERRY, MOCHE y FLORENCIA DE MORA entre ellos) y la columna
 * `provincia` corrompida en 29 prefijos. Quien emitiera una guía a esos
 * destinos no podía seleccionarlos. Un solo archivo evita que vuelvan a
 * divergir.
 *
 * La jerarquía NO necesita tablas: está en el código. 2 dígitos =
 * departamento, 4 = provincia, 6 = distrito. Verificado: los prefijos son
 * 100% consistentes en ambos niveles.
 *
 * ⚠️ El JSON llega a `dist/` porque está listado en los `assets` de
 * `nest-cli.json`. Si se mueve o renombra, actualizar ahí o revienta en
 * producción con ENOENT.
 */
@Injectable()
export class UbigeoService {
  private _cache: UbigeoFila[] | null = null;

  /** Los 1892 distritos, tal como los espera el selector de guías. */
  todos(): UbigeoFila[] {
    if (!this._cache) {
      const ruta = path.join(__dirname, 'ubigeos-peru.json');
      this._cache = JSON.parse(fs.readFileSync(ruta, 'utf-8')) as UbigeoFila[];
    }
    return this._cache;
  }

  departamentos() {
    const m = new Map<string, string>();
    for (const f of this.todos()) m.set(f.ubigeo.slice(0, 2), f.departamento);
    return [...m].map(([codigo, nombre]) => ({ codigo, nombre })).sort(porNombre);
  }

  provincias(departamento?: string) {
    const pref = (departamento ?? '').trim();
    if (!/^\d{2}$/.test(pref)) {
      throw new BadRequestException(
        'departamento debe ser el código de 2 dígitos',
      );
    }
    const m = new Map<string, string>();
    for (const f of this.todos()) {
      if (f.ubigeo.startsWith(pref)) m.set(f.ubigeo.slice(0, 4), f.provincia);
    }
    return [...m].map(([codigo, nombre]) => ({ codigo, nombre })).sort(porNombre);
  }

  distritos(provincia?: string) {
    const pref = (provincia ?? '').trim();
    if (!/^\d{4}$/.test(pref)) {
      throw new BadRequestException(
        'provincia debe ser el código de 4 dígitos',
      );
    }
    return this.todos()
      .filter((f) => f.ubigeo.startsWith(pref))
      .map((f) => ({ codigo: f.ubigeo, nombre: f.distrito }))
      .sort(porNombre);
  }
}
