/**
 * Catálogo de permisos granulares.
 *
 * Estos permisos viven en `UsuarioSedeRol.permisos: String[]` y se asignan
 * por usuario individual (no por rol). Su propósito es dar al admin
 * control fino sin requerir migrations cada vez que aparece una capacidad
 * nueva.
 *
 * **Cuándo agregar un permiso aquí**:
 *  - Cuando una operación necesita autorización por usuario individual,
 *    no por rol entero (ej. "este vendedor puede aplicar descuentos
 *    libres pero los demás no").
 *  - Cuando la operación es cross-cutting y no se mapea a un rol claro.
 *
 * **Cuándo NO agregar aquí**:
 *  - Si el permiso es por rol (ej. "todo cajero puede X") → `Permission`
 *    enum + `PermissionsService.calculatePermissions`.
 *  - Si es solo de UI (ej. ocultar un acceso rápido) →
 *    `accesosRapidosOcultos`.
 *  - 🔴 **Si lo que se quiere es QUITARLE algo a alguien que su rol ya le
 *    da.** Este mecanismo solo SUMA: `calculatePermissions` hace un OR del
 *    granular sobre el rol, y un admin tiene todos los granulares por
 *    definición. Un permiso pensado como "que el vendedor NO vea X" es
 *    inexpresable acá y termina siendo una casilla que no hace nada.
 *
 * Esa última regla no es teórica: el catálogo llegó a tener 11 permisos de los
 * cuales 9 no los consultaba nadie (29-08). Los que querían restringir —
 * `producto.ver-costo`, `cliente.ver-credito`, `caja.movimiento-anular`— eran
 * justamente los sustractivos, y se eliminaron: ocultar un campo según quién
 * pregunta es filtrar la respuesta, no conceder un permiso. `venta.anular` se
 * fue porque la anulación ya valida el rol de quien autoriza, y
 * `cotizacion.aprobar-grande` porque nunca se definió cuánto era "grande".
 *
 * **Regla práctica**: si no podés nombrar el endpoint que va a consultarlo,
 * no lo agregues.
 *
 * **Convención de IDs**: `dominio.accion`, kebab-case (`caja.abrir`,
 * `venta.descuento-libre`, `producto.ver-costo`).
 */
export interface GranularPermission {
  id: string;
  label: string;
  description: string;
  category: string;
}

export const GRANULAR_PERMISSIONS_CATALOG: readonly GranularPermission[] = [
  // ── Caja ──
  {
    id: 'caja.abrir',
    label: 'Abrir caja',
    description: 'Permite abrir la caja del turno aunque no sea CAJERO/ADMIN.',
    category: 'Caja',
  },
  {
    id: 'caja.cerrar',
    label: 'Cerrar caja',
    description: 'Permite cerrar caja con conteo físico.',
    category: 'Caja',
  },

  // ── Venta ──
  {
    id: 'venta.descuento-libre',
    label: 'Aplicar descuento libre',
    description: 'Aplicar descuentos sin solicitar autorización superior.',
    category: 'Venta',
  },
  {
    id: 'venta.editar-precio',
    label: 'Editar precio en venta',
    description: 'Modificar el precio de un producto al momento de cobrar.',
    category: 'Venta',
  },

  // ── Producto ──
  {
    id: 'producto.editar-costo',
    label: 'Editar costo de productos',
    description: 'Modificar el costo registrado del producto.',
    category: 'Producto',
  },

  // ── Devolución ──
  {
    id: 'devolucion.crear',
    label: 'Crear devolución',
    description:
      'Registrar devoluciones de venta sin ser administrador (por defecto ' +
      'solo los admin pueden).',
    category: 'Devolución',
  },
] as const;

/**
 * Constantes con los IDs para usarse desde código en lugar de strings
 * sueltos. Permite refactor seguro y autocompletado.
 */
export class GranularPermissionId {
  static readonly CAJA_ABRIR = 'caja.abrir';
  static readonly CAJA_CERRAR = 'caja.cerrar';

  static readonly VENTA_DESCUENTO_LIBRE = 'venta.descuento-libre';
  static readonly VENTA_EDITAR_PRECIO = 'venta.editar-precio';

  static readonly PRODUCTO_EDITAR_COSTO = 'producto.editar-costo';

  static readonly DEVOLUCION_CREAR = 'devolucion.crear';
}

/** IDs válidos del catálogo (validación de input). */
export const VALID_GRANULAR_PERMISSION_IDS = new Set(
  GRANULAR_PERMISSIONS_CATALOG.map((p) => p.id),
);
