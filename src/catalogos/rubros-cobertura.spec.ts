import { RubroEmpresa } from '@prisma/client';
import { CatalogosService } from './catalogos.service';

/**
 * Un rubro que no está ni en CATALOGOS_POR_RUBRO ni en RUBROS_GENERICOS crea la
 * empresa con CERO categorías y CERO marcas: `activarCatalogosSegunRubro` solo
 * loguea un warning y devuelve vacío, y encima corre dentro de un
 * Promise.allSettled, así que no hay error visible en ningún lado.
 *
 * Pasó al agregar MASCOTAS al enum (04-08).
 */
describe('cobertura de catálogos por rubro', () => {
  const config = (CatalogosService as any).CATALOGOS_POR_RUBRO as Record<
    string,
    unknown
  >;
  const genericos = (CatalogosService as any).RUBROS_GENERICOS as string[];

  it('todo valor de RubroEmpresa tiene catálogo propio o cae en los populares', () => {
    const sinCobertura = Object.values(RubroEmpresa).filter(
      (rubro) => !config[rubro] && !genericos.includes(rubro),
    );

    expect(sinCobertura).toEqual([]);
  });

  it('ningún rubro está en las dos listas a la vez', () => {
    const duplicados = Object.keys(config).filter((rubro) =>
      genericos.includes(rubro),
    );

    expect(duplicados).toEqual([]);
  });

  it('las listas no nombran rubros que el enum no tiene', () => {
    const validos = Object.values(RubroEmpresa) as string[];
    const inventados = [...Object.keys(config), ...genericos].filter(
      (rubro) => !validos.includes(rubro),
    );

    expect(inventados).toEqual([]);
  });
});
