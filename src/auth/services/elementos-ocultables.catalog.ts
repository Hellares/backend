/**
 * Catálogo de elementos de UI que un administrador puede ocultarle a un
 * usuario. Viven en `UsuarioSedeRol.accesosRapidosOcultos`.
 *
 * Son dos familias en una sola lista, y es a propósito: un id que existe en
 * los dos lados —`cotizaciones`, `caja`, `ventas`— se oculta de una sola vez
 * en el dashboard y en el menú lateral.
 *
 *  - **Dashboard**: los 21 botones de acceso rápido. Sin prefijo.
 *  - **Menú lateral**: los ítems del drawer, con prefijo `menu.` para que no
 *    puedan chocar con los de arriba.
 *
 * ⚠️ Esto OCULTA, no autoriza. Que un ítem no se dibuje no impide llegar a la
 * ruta: lo que restringe de verdad son los permisos del rol. Por eso este
 * catálogo NO vive junto a `granular-permissions.catalog.ts` en cuanto a
 * intención, aunque se validen igual.
 *
 * 🔴 **Espejo manual de Flutter.** La fuente de la que salieron estos ids es
 * `syncronize-app`:
 *   - `lib/features/empresa/presentation/widgets/accesos_rapidos_section.dart`
 *     (`AccesosRapidosCatalogo`)
 *   - `lib/core/utils/menu_drawer_catalogo.dart` (`MenuDrawerCatalogo`)
 *
 * Si agregás uno allá, agregalo acá. Si te olvidás, el síntoma es un 400 al
 * guardar el usuario —ruidoso y localizable—, que es preferible al anterior:
 * el id se guardaba en silencio y nadie entendía por qué el elemento seguía
 * apareciendo.
 *
 * 🔴 Los ids son **estables para siempre**. Renombrar uno le devuelve el
 * elemento a todos los usuarios que lo tenían oculto, sin que nadie haya
 * tocado su configuración.
 */

/** Los 21 botones del dashboard. */
const DASHBOARD = [
  'venta-rapida',
  'venta-avanzada',
  'cola-pos',
  'ventas',
  'cotizaciones',
  'caja',
  'monitor-cajas',
  'historial-cajas',
  'tesoreria',
  'caja-chica',
  'cuentas-por-cobrar',
  'finanzas',
  'facturacion',
  'productos',
  'servicios',
  'monitor-productos',
  'ordenes-servicio',
  'flujo-docs',
  'guias-remision',
  'sorteos',
  'config',
] as const;

/**
 * Ítems del menú lateral, solo de las 5 secciones operativas (Ventas,
 * Servicios, Tesorería, Facturación SUNAT, Inventario). Administración y
 * Catálogos quedaron afuera a propósito: ya las cierran los permisos del rol.
 */
const MENU = [
  'menu.ventas.devoluciones',
  'menu.ventas.reportes',
  'menu.ventas.politicas-descuento',
  'menu.ventas.tipo-cambio',
  'menu.servicios.citas',
  'menu.servicios.historial-cliente',
  'menu.servicios.plantillas',
  'menu.servicios.tercerizacion',
  'menu.servicios.vinculaciones',
  'menu.tesoreria.consolidado',
  'menu.tesoreria.gastos-recurrentes',
  'menu.tesoreria.cuentas-bancarias',
  'menu.tesoreria.cuentas-recaudacion',
  'menu.tesoreria.agentes-bancarios',
  'menu.facturacion.catalogos-gre',
  'menu.facturacion.anulaciones',
  'menu.facturacion.correlativos',
  'menu.inventario.stock-sede',
  'menu.inventario.alertas-stock',
  'menu.inventario.transferencias',
  'menu.inventario.incidencias-transferencia',
  'menu.inventario.reportes-incidencia',
  'menu.inventario.kardex',
  'menu.inventario.produccion',
  'menu.inventario.abrir-bultos',
  'menu.inventario.trazabilidad',
  'menu.inventario.inventario-fisico',
  'menu.inventario.stock-ubicacion',
  'menu.inventario.gestion-ubicaciones',
  'menu.inventario.stock-min-max',
  'menu.inventario.merma',
  'menu.inventario.valorizacion',
  'menu.inventario.reorden',
  'menu.inventario.rotacion',
  'menu.inventario.historial-precios',
  'menu.inventario.codigos-barras',
] as const;

export const ELEMENTOS_OCULTABLES = [...DASHBOARD, ...MENU];

/** Ids válidos, para validar el input del cliente. */
export const VALID_ELEMENTO_OCULTABLE_IDS = new Set<string>(
  ELEMENTOS_OCULTABLES,
);
