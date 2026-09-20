/**
 * Campo de plantilla con selección en CASCADA (`OPCION_DEPENDIENTE`).
 *
 * Fabricante → Familia → Modelo: cada nivel ofrece solo lo que cuelga del
 * valor elegido en el anterior. A diferencia de los atributos de producto
 * —que tienen tabla propia (`ProductoAtributoOpcion`) y encadenan atributos
 * distintos— acá TODO vive en un solo campo y en la columna `opciones`, que
 * ya era Json libre.
 *
 * Forma esperada de `opciones`:
 *
 *     {
 *       "niveles": ["Fabricante", "Familia", "Modelo"],
 *       "arbol": [
 *         { "valor": "QUALCOMM", "hijos": [
 *           { "valor": "SNAPDRAGON", "hijos": [ { "valor": "8 Gen 3" } ] }
 *         ]}
 *       ]
 *     }
 *
 * El VALOR que se guarda en la orden es la ruta unida por `" / "`:
 * `"QUALCOMM / SNAPDRAGON / 8 Gen 3"`.
 *
 * 🔴 El separador es ASCII a propósito: este valor sale impreso en tickets
 * térmicos, cuyos code pages no tienen cualquier carácter.
 */

/** Separador de la ruta. Mismo criterio que el nombre de variante. */
export const SEP_DEPENDIENTE = ' / ';

export interface NodoOpcion {
  valor: string;
  hijos?: NodoOpcion[];
}

export interface ArbolDependiente {
  niveles: string[];
  arbol: NodoOpcion[];
}

function esNodo(n: unknown): n is NodoOpcion {
  if (typeof n !== 'object' || n === null || Array.isArray(n)) return false;
  const o = n as Record<string, unknown>;
  if (typeof o.valor !== 'string' || o.valor.trim() === '') return false;
  if (o.hijos === undefined) return true;
  return Array.isArray(o.hijos) && o.hijos.every(esNodo);
}

/**
 * Lee `opciones` y devuelve el árbol, o null si no tiene la forma esperada.
 *
 * Devolver null y no tirar es a propósito: un campo mal configurado no debe
 * hacer fallar el guardado de la orden entera; la validación de la forma va
 * al CREAR el campo (ver `validarArbolDependiente`).
 */
export function leerArbolDependiente(
  opciones: unknown,
): ArbolDependiente | null {
  if (typeof opciones !== 'object' || opciones === null) return null;
  const o = opciones as Record<string, unknown>;
  const niveles = o.niveles;
  const arbol = o.arbol;
  if (!Array.isArray(niveles) || niveles.length === 0) return null;
  if (!niveles.every((n) => typeof n === 'string' && n.trim() !== '')) {
    return null;
  }
  if (!Array.isArray(arbol) || !arbol.every(esNodo)) return null;
  return { niveles: niveles as string[], arbol: arbol as NodoOpcion[] };
}

/**
 * ¿La ruta existe en el árbol?
 *
 * Se exige llegar a una hoja o completar todos los niveles: una ruta a medias
 * ("QUALCOMM" cuando hay tres niveles) deja el dato incompleto y es lo que
 * pasa si el cliente manda el campo sin terminar de elegir.
 */
export function rutaValida(a: ArbolDependiente, ruta: string[]): boolean {
  if (ruta.length === 0 || ruta.length > a.niveles.length) return false;
  let nivel: NodoOpcion[] = a.arbol;
  for (let i = 0; i < ruta.length; i++) {
    const nodo = nivel.find((n) => n.valor === ruta[i]);
    if (!nodo) return false;
    const hijos = nodo.hijos ?? [];
    const esUltimo = i === ruta.length - 1;
    if (esUltimo) {
      // Llegó al final de lo elegido: vale si el nodo no tiene por dónde
      // seguir. Si tiene hijos, faltó elegir.
      return hijos.length === 0;
    }
    nivel = hijos;
  }
  return false;
}

/** Parte `"A / B / C"` en sus tramos, tolerando espacios de más. */
export function partirRuta(valor: string): string[] {
  return valor
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/**
 * Valida la FORMA del árbol al crear/editar el campo. Acá sí se tira, porque
 * guardar un árbol inválido deja un campo que nadie puede completar.
 *
 * Devuelve el motivo del rechazo, o null si está bien.
 */
export function validarArbolDependiente(opciones: unknown): string | null {
  const a = leerArbolDependiente(opciones);
  if (!a) {
    return 'La cascada necesita { niveles: ["Fabricante", ...], arbol: [{ valor, hijos }] }';
  }
  if (a.arbol.length === 0) return 'La cascada no tiene ninguna opción cargada';

  // La profundidad no puede pasarse de los niveles declarados: un nodo más
  // abajo del último nivel no se podría elegir nunca.
  const excede = (nodos: NodoOpcion[], prof: number): boolean =>
    nodos.some(
      (n) =>
        prof > a.niveles.length ||
        excede(n.hijos ?? [], prof + 1),
    );
  if (excede(a.arbol, 1)) {
    return `La cascada tiene opciones más abajo del último nivel ("${a.niveles[a.niveles.length - 1]}")`;
  }

  const duplicados = (nodos: NodoOpcion[]): boolean => {
    const vistos = new Set<string>();
    for (const n of nodos) {
      const k = n.valor.trim().toUpperCase();
      if (vistos.has(k)) return true;
      vistos.add(k);
      if (duplicados(n.hijos ?? [])) return true;
    }
    return false;
  };
  if (duplicados(a.arbol)) {
    return 'Hay opciones repetidas dentro del mismo nivel';
  }
  return null;
}
