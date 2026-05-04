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
  {
    id: 'caja.movimiento-anular',
    label: 'Anular movimiento de caja',
    description: 'Anular un ingreso/egreso registrado en caja.',
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
    id: 'venta.anular',
    label: 'Anular venta',
    description: 'Anular ventas ya registradas.',
    category: 'Venta',
  },
  {
    id: 'venta.editar-precio',
    label: 'Editar precio en venta',
    description: 'Modificar el precio de un producto al momento de cobrar.',
    category: 'Venta',
  },

  // ── Cotización ──
  {
    id: 'cotizacion.aprobar-grande',
    label: 'Aprobar cotización grande',
    description: 'Aprobar cotizaciones que excedan el límite estándar.',
    category: 'Cotización',
  },

  // ── Producto ──
  {
    id: 'producto.ver-costo',
    label: 'Ver costo de productos',
    description: 'Ver el campo costo en producto y reportes.',
    category: 'Producto',
  },
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
    description: 'Registrar devolución de venta.',
    category: 'Devolución',
  },

  // ── Cliente ──
  {
    id: 'cliente.ver-credito',
    label: 'Ver crédito de clientes',
    description: 'Ver línea de crédito y deuda actual de cada cliente.',
    category: 'Cliente',
  },
] as const;

/**
 * Constantes con los IDs para usarse desde código en lugar de strings
 * sueltos. Permite refactor seguro y autocompletado.
 */
export class GranularPermissionId {
  static readonly CAJA_ABRIR = 'caja.abrir';
  static readonly CAJA_CERRAR = 'caja.cerrar';
  static readonly CAJA_MOVIMIENTO_ANULAR = 'caja.movimiento-anular';

  static readonly VENTA_DESCUENTO_LIBRE = 'venta.descuento-libre';
  static readonly VENTA_ANULAR = 'venta.anular';
  static readonly VENTA_EDITAR_PRECIO = 'venta.editar-precio';

  static readonly COTIZACION_APROBAR_GRANDE = 'cotizacion.aprobar-grande';

  static readonly PRODUCTO_VER_COSTO = 'producto.ver-costo';
  static readonly PRODUCTO_EDITAR_COSTO = 'producto.editar-costo';

  static readonly DEVOLUCION_CREAR = 'devolucion.crear';

  static readonly CLIENTE_VER_CREDITO = 'cliente.ver-credito';
}

/** IDs válidos del catálogo (validación de input). */
export const VALID_GRANULAR_PERMISSION_IDS = new Set(
  GRANULAR_PERMISSIONS_CATALOG.map((p) => p.id),
);
