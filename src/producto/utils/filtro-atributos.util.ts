import { Prisma } from '@prisma/client';

/**
 * Traduce `["fabricante:QUALCOMM", "fabricante:SAMSUNG", "ram:8GB"]` a
 * condiciones Prisma sobre `Producto`.
 *
 * Claves distintas se combinan con **Y** (quiero Qualcomm Y 8GB); varios
 * valores de la misma clave, con **O** (Qualcomm O Samsung). Es el
 * comportamiento que espera cualquiera que haya usado un filtro de tienda.
 *
 * 🔑 El valor puede estar en el producto base **o** en alguna de sus variantes:
 * un producto con variantes no guarda los atributos en sí mismo, los guarda
 * cada variante. Buscar solo en el producto no encontraría nada justamente en
 * los catálogos con variantes, que son los que más se filtran.
 *
 * Vive suelto y no dentro de un servicio porque lo usan dos: el catálogo de la
 * empresa (`ProductoCatalogService`) y el marketplace, que arman su `where` por
 * separado. Con una copia en cada uno, las semánticas se separan sin que nadie
 * lo note.
 */
export function condicionesPorAtributo(
  atributos: string[] | undefined,
): Prisma.ProductoWhereInput[] {
  if (!atributos || atributos.length === 0) return [];

  const porClave = new Map<string, string[]>();
  for (const entrada of atributos) {
    // Split en el PRIMER ':' — un valor bien puede traer otro adentro.
    const corte = entrada.indexOf(':');
    if (corte <= 0) continue;
    const clave = entrada.slice(0, corte).trim();
    const valor = entrada.slice(corte + 1).trim();
    if (!clave || !valor) continue;
    const actuales = porClave.get(clave) ?? [];
    actuales.push(valor);
    porClave.set(clave, actuales);
  }

  return Array.from(porClave.entries()).map(([clave, valores]) => ({
    OR: [
      {
        atributosValores: {
          some: { atributo: { clave }, valor: { in: valores } },
        },
      },
      {
        variantes: {
          some: {
            isActive: true,
            deletedAt: null,
            atributosValores: {
              some: { atributo: { clave }, valor: { in: valores } },
            },
          },
        },
      },
    ],
  }));
}

/**
 * Suma [condiciones] al `AND` que ya tenga [where], sin pisarlo.
 *
 * 🔴 Asignar `where.AND` directamente es el error fácil: la búsqueda por texto
 * ya lo usa para exigir que cada palabra aparezca, y sobrescribirlo la borra
 * sin que nadie lo note.
 */
export function sumarAlAnd(
  where: { AND?: unknown },
  condiciones: Prisma.ProductoWhereInput[],
): void {
  if (condiciones.length === 0) return;
  const previas = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];
  where.AND = [...previas, ...condiciones];
}
