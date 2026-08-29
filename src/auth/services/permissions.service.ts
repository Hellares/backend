import { Injectable } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { EmpresaPermissionsDto } from '../../empresa/dto';
import { GranularPermissionId } from './granular-permissions.catalog';

/**
 * Servicio centralizado para el cálculo de permisos
 *
 * Este servicio es la ÚNICA fuente de verdad para la lógica de permisos.
 * Tanto PermissionsGuard como EmpresaService deben usar este servicio.
 *
 * IMPORTANTE: Si necesitas agregar/modificar permisos, hazlo AQUÍ.
 */
/**
 * Overrides individuales por sede que amplían los permisos derivados
 * del rol. Si el usuario tiene el flag/permiso en CUALQUIER sede de la
 * empresa, se concede a nivel global (el guard a nivel sede específica
 * se valida en el endpoint si aplica).
 *
 * - `permisos`: array consolidado de IDs del catálogo granular
 *   (`UsuarioSedeRol.permisos`). Es la ÚNICA fuente.
 *
 * 🔴 Las columnas `puedeAbrirCaja` / `puedeCerrarCaja` de `UsuarioSedeRol` ya
 * NO se leen (29-08). Eran la "Fase A" de una migración a medias: dos fuentes
 * para la misma capacidad, unidas por un OR. Se verificó en las dos bases que
 * todo usuario con el flag prendido tiene también el id del catálogo, así que
 * el backfill que la Fase B esperaba está completo.
 *
 * Las columnas NO se dropearon a propósito: las migraciones de este proyecto
 * son aditivas para que el rollback de prod sea "volver a la imagen anterior"
 * y nada más. Una imagen vieja las sigue leyendo y encuentra lo que necesita,
 * porque el app las sigue escribiendo derivadas del catálogo.
 */
export interface PermissionsOverrides {
  permisos?: readonly string[];
}

/**
 * Un permiso con su procedencia, para la pantalla "qué puede hacer este
 * usuario".
 *
 * `origen`:
 *  - `rol`      → se lo da un rol de empresa; `detalle` dice cuál.
 *  - `especial` → se lo da un permiso granular; `detalle` dice cuál.
 *  - `null`     → no lo tiene.
 */
export interface PermisoExplicado {
  clave: string;
  valor: boolean;
  origen: 'rol' | 'especial' | null;
  detalle: string | null;
}

@Injectable()
export class PermissionsService {
  /**
   * Calcula permisos basados en los roles del usuario y opcionalmente
   * en overrides individuales (flags de `UsuarioSedeRol`).
   *
   * @param roles - Array de roles del usuario en la empresa
   * @param overrides - Flags opcionales que amplían los permisos por rol
   *                    (típicamente derivados de `UsuarioSedeRol`).
   * @returns Objeto con todos los permisos como propiedades boolean
   */
  calculatePermissions(
    roles: Rol[],
    overrides?: PermissionsOverrides,
  ): EmpresaPermissionsDto {
    const isSuperAdmin = roles.includes(Rol.SUPER_ADMIN);
    const isEmpresaAdmin = roles.includes(Rol.EMPRESA_ADMIN);
    const isSedeAdmin = roles.includes(Rol.SEDE_ADMIN);
    const isCajero = roles.includes(Rol.CAJERO);
    const isVendedor = roles.includes(Rol.VENDEDOR);
    const isTecnico = roles.includes(Rol.TECNICO);
    const isContador = roles.includes(Rol.CONTADOR);
    const isLectura = roles.includes(Rol.LECTURA);
    const isOperador = roles.includes(Rol.OPERADOR);

    // Helpers de nivel — simplifican la asignación y evitan errores al agregar roles
    const isAdmin = isSuperAdmin || isEmpresaAdmin;
    const isAnyAdmin = isAdmin || isSedeAdmin;
    const isOperativo = isVendedor || isCajero || isTecnico || isOperador;
    const isViewer = isLectura; // solo lectura, nunca MANAGE

    // Capacidad de caja: sale del catálogo granular y de nada más. Si el
    // usuario tiene el ID en cualquier sede de la empresa, se concede.
    const puedeAbrirCaja =
      overrides?.permisos?.includes(GranularPermissionId.CAJA_ABRIR) ?? false;
    const puedeCerrarCaja =
      overrides?.permisos?.includes(GranularPermissionId.CAJA_CERRAR) ?? false;

    // Granulares que AMPLÍAN lo que da el rol. Todos siguen el mismo patrón:
    // el permiso base queda como estaba y se le hace OR con el granular, así
    // un usuario puntual puede recibir la capacidad sin cambiarle el rol.
    //
    // 🔴 Solo se agregan acá permisos ADITIVOS. Uno pensado para restringir
    // ("que este no vea los costos") no se puede expresar con un OR y termina
    // siendo una casilla muerta — ver el comentario del catálogo.
    const tieneDevolucionCrear =
      overrides?.permisos?.includes(GranularPermissionId.DEVOLUCION_CREAR) ??
      false;
    const tieneProductoEditarCosto =
      overrides?.permisos?.includes(
        GranularPermissionId.PRODUCTO_EDITAR_COSTO,
      ) ?? false;
    const tieneVentaDescuentoLibre =
      overrides?.permisos?.includes(
        GranularPermissionId.VENTA_DESCUENTO_LIBRE,
      ) ?? false;
    const tieneVentaEditarPrecio =
      overrides?.permisos?.includes(GranularPermissionId.VENTA_EDITAR_PRECIO) ??
      false;

    return {
      // ==================== USUARIOS ====================
      canViewUsers:
        isAnyAdmin || isContador || isViewer,
      canManageUsers: isAdmin,

      // ==================== PRODUCTOS ====================
      canViewProducts:
        isAnyAdmin || isOperativo || isContador || isViewer,
      canManageProducts: isAnyAdmin,

      // ==================== SERVICIOS ====================
      canViewServices:
        isAnyAdmin || isTecnico || isCajero || isVendedor || isContador || isViewer,
      canManageServices:
        isAnyAdmin || isTecnico,

      // ==================== CLIENTES ====================
      canViewClients:
        isAnyAdmin || isOperativo || isContador || isViewer,
      canManageClients:
        isAnyAdmin || isVendedor || isCajero || isOperador,

      // ==================== SEDES ====================
      canManageSedes: isAdmin,

      // ==================== REPORTES ====================
      // 🔴 El CAJERO salió de acá (29-08). Este permiso no da "ver reportes de
      // lo mío": es la llave de los módulos financieros de administración —
      // libro contable, préstamos, flujo proyectado, metas, cuentas bancarias
      // y de recaudación—, y además abría en el drawer las secciones Finanzas
      // y Facturación SUNAT enteras.
      //
      // Un cajero seguía viendo el libro contable de la empresa por tener este
      // flag. Lo suyo —su caja, sus ventas, su facturación— pasa por
      // `canViewCaja`, `canViewVentas` y `canManageInvoices`, que conserva.
      canViewReports: isAnyAdmin || isContador || isViewer,

      // ==================== FACTURAS ====================
      canManageInvoices:
        isAnyAdmin || isCajero || isContador,

      // ==================== ÓRDENES DE SERVICIO ====================
      canManageOrders:
        isAnyAdmin || isTecnico,

      // ==================== ESTADÍSTICAS ====================
      canViewStatistics:
        isAnyAdmin || isContador || isViewer,

      // ==================== CONFIGURACIÓN ====================
      canManageSettings: isAdmin,
      canManagePaymentMethods: isAdmin,
      canChangePlan: isAdmin,

      // ==================== DESCUENTOS ====================
      canViewDiscounts: isAnyAdmin || isContador || isViewer,
      canManageDiscounts: isAdmin,
      canAssignDiscounts: isAdmin,

      // ==================== GRANULARES ADITIVOS ====================
      // Descuento sin pedir autorización superior. El app lo usa para saltear
      // el diálogo de autorización: sin esto, un vendedor de confianza tenía
      // que hacer venir a un admin en cada venta.
      canDescuentoLibre: isAdmin || tieneVentaDescuentoLibre,

      // Cambiar el precio de una línea al cobrar.
      canEditarPrecioVenta: isAdmin || tieneVentaEditarPrecio,

      // Editar el precio de COSTO de un producto. Ojo: `canManageProducts`
      // sigue siendo solo-admin y cubre TODO el producto; este es la llave
      // fina, solo para el costo.
      canEditarCostoProducto: isAnyAdmin || tieneProductoEditarCosto,

      // ==================== COTIZACIONES ====================
      canViewCotizaciones:
        isAnyAdmin || isVendedor || isCajero || isContador || isViewer,
      canManageCotizaciones:
        isAnyAdmin || isVendedor,

      // ==================== VENTAS ====================
      canViewVentas:
        isAnyAdmin || isVendedor || isCajero || isContador || isViewer,
      canManageVentas:
        isAnyAdmin || isVendedor || isCajero,

      // ==================== DEVOLUCIONES ====================
      canViewDevoluciones:
        isAnyAdmin || isVendedor || isCajero || isContador || isViewer,
      // Por defecto solo admin; el granular `devolucion.crear` habilita a una
      // persona puntual sin tener que cambiarle el rol.
      canManageDevoluciones: isAnyAdmin || tieneDevolucionCrear,

      // ==================== PROVEEDORES ====================
      canViewProveedores:
        isAnyAdmin || isContador || isOperador || isViewer,
      canManageProveedores: isAnyAdmin,

      // ==================== COMPRAS ====================
      canViewCompras:
        isAnyAdmin || isContador || isOperador || isViewer,
      canManageCompras: isAnyAdmin,
      canApproveOrdenesCompra: isAdmin,

      // ==================== REPORTES DE INCIDENCIA ====================
      canViewReportesIncidencia:
        isAnyAdmin || isContador || isTecnico || isViewer,
      canManageReportesIncidencia:
        isAnyAdmin || isTecnico,

      // ==================== CAJA ====================
      canViewCaja:
        isAnyAdmin || isCajero || isContador ||
        puedeAbrirCaja || puedeCerrarCaja,
      canManageCaja:
        isAnyAdmin || isCajero ||
        puedeAbrirCaja || puedeCerrarCaja,
      // Abrir y cerrar se conceden por separado, vía flag legacy o vía
      // catálogo (`caja.abrir` / `caja.cerrar`).
      //
      // 🔴 `isCajero` SALIÓ de estas dos (29-08), y es el punto: el uso real
      // del negocio es "abre pero no cierra" —el cierre lo hace el admin—, y
      // era el único caso en prod y 5 de 8 en beta. Con `isCajero` acá,
      // destildarle "puede cerrar caja" a un cajero no le quitaba nada: el
      // permiso seguía dando true por su rol, la UI le escondía el botón y el
      // endpoint `CERRAR_CAJA` le aceptaba la petición igual. La restricción
      // era cosmética.
      //
      // Ahora el rol no concede: el flag es el interruptor real. El preset del
      // CAJERO prende los dos, así que un cajero nuevo sigue pudiendo abrir y
      // cerrar por defecto — pero destildarlo ahora SÍ se lo quita, en la UI y
      // en el servidor.
      //
      // `canViewCaja` y `canManageCaja` conservan `isCajero` a propósito: un
      // cajero tiene que ver y operar su caja igualmente.
      canAbrirCaja: isAnyAdmin || puedeAbrirCaja,
      canCerrarCaja: isAnyAdmin || puedeCerrarCaja,

      // ==================== RRHH - EMPLEADOS ====================
      canViewEmpleados:
        isAnyAdmin || isContador || isViewer,
      canManageEmpleados: isAdmin,

      // ==================== RRHH - ASISTENCIA ====================
      canViewAsistencia:
        isAnyAdmin || isContador || isViewer,
      canManageAsistencia: isAnyAdmin,

      // ==================== RRHH - PLANILLA ====================
      canViewPlanilla:
        isAnyAdmin || isContador,
      canManagePlanilla: isAdmin,

      // ==================== RRHH - APROBACIONES ====================
      canApproveIncidencias: isAnyAdmin,
      canApprovePlanilla: isAdmin,

      // ==================== GASTOS RECURRENTES ====================
      canViewGastosRecurrentes:
        isAnyAdmin || isContador || isViewer,
      canManageGastosRecurrentes:
        isAnyAdmin || isContador,
    };
  }

  /**
   * Verifica si los roles dados tienen un permiso específico
   *
   * @param roles - Array de roles del usuario
   * @param permission - Nombre del permiso a verificar (ej: 'canManageProducts')
   * @returns true si tiene el permiso, false en caso contrario
   */
  hasPermission(roles: Rol[], permission: string): boolean {
    const permissions = this.calculatePermissions(roles);
    return permissions[permission] === true;
  }

  /**
   * Verifica un permiso GRANULAR (catálogo `granular-permissions.catalog`)
   * combinando 3 fuentes en orden:
   *  1. El array `permisos` del `UsuarioSedeRol` (consolidado entre sedes).
   *  2. Compat con flags legacy: `caja.abrir` ↔ `puedeAbrirCaja`,
   *     `caja.cerrar` ↔ `puedeCerrarCaja`. Mientras la migración a
   *     strings esté en progreso, los flags siguen siendo verdad.
   *  3. SUPER_ADMIN/EMPRESA_ADMIN tienen TODOS los granulares.
   *
   * Pensado para usarse desde endpoints que necesiten autorización
   * por usuario (ej. `if (!hasGranular(...)) throw 403`).
   */
  hasGranularPermission(
    permisos: readonly string[],
    permId: string,
    options?: {
      roles?: Rol[];
      overrides?: PermissionsOverrides;
    },
  ): boolean {
    // Admin global tiene todos los granulares.
    if (
      options?.roles?.includes(Rol.SUPER_ADMIN) ||
      options?.roles?.includes(Rol.EMPRESA_ADMIN)
    ) {
      return true;
    }
    // Catálogo: presencia explícita en el array. La compatibilidad con los
    // flags legacy de caja se quitó junto con su lectura en
    // `calculatePermissions` — hoy el catálogo es la única fuente.
    return permisos.includes(permId);
  }

  /**
   * Retorna todos los permisos disponibles en el sistema
   * Útil para documentación o generar interfaces
   */
  getAllAvailablePermissions(): string[] {
    return [
      'canViewUsers',
      'canManageUsers',
      'canViewProducts',
      'canManageProducts',
      'canViewServices',
      'canManageServices',
      'canViewClients',
      'canManageClients',
      'canManageSedes',
      'canViewReports',
      'canManageInvoices',
      'canManageOrders',
      'canViewStatistics',
      'canManageSettings',
      'canManagePaymentMethods',
      'canChangePlan',
      'canViewDiscounts',
      'canManageDiscounts',
      'canAssignDiscounts',
      'canViewCotizaciones',
      'canManageCotizaciones',
      'canViewVentas',
      'canManageVentas',
      'canViewDevoluciones',
      'canManageDevoluciones',
      'canViewProveedores',
      'canManageProveedores',
      'canViewCompras',
      'canManageCompras',
      'canApproveOrdenesCompra',
      'canViewReportesIncidencia',
      'canManageReportesIncidencia',
      'canViewCaja',
      'canManageCaja',
      'canAbrirCaja',
      'canCerrarCaja',
      'canViewEmpleados',
      'canManageEmpleados',
      'canViewAsistencia',
      'canManageAsistencia',
      'canViewPlanilla',
      'canManagePlanilla',
      'canApproveIncidencias',
      'canApprovePlanilla',
      'canViewGastosRecurrentes',
      'canManageGastosRecurrentes',
    ];
  }

  /**
   * Explica, permiso por permiso, si el usuario lo tiene y DE DÓNDE le viene.
   *
   * Es lo que convierte un volcado de 45 booleanos en algo accionable: la
   * pregunta real de un admin nunca es "¿tiene canViewCaja?" sino "¿por qué
   * este cajero ve el libro contable?".
   *
   * 🔴 No toca `calculatePermissions` — la usa tal cual, tres veces, y deduce
   * el origen por diferencia. Meterle mano a esa función para que registrara
   * su propia procedencia habría duplicado cada regla, con el riesgo clásico
   * de que la explicación y el cálculo se separen y la pantalla mienta.
   *
   *  - Lo que dan los roles solos vs. lo que da con los granulares: la
   *    diferencia vino sí o sí de un permiso especial.
   *  - Y para saber CUÁL rol lo aporta, se calcula rol por rol.
   */
  explicarPermisos(
    roles: Rol[],
    overrides?: PermissionsOverrides,
  ): PermisoExplicado[] {
    const efectivos = this.calculatePermissions(roles, overrides);
    // Sin granulares ni flags: solo lo que otorga el rol por sí mismo.
    const soloRoles = this.calculatePermissions(roles);

    // Qué aporta cada rol por separado, para poder nombrarlo.
    const porRol = roles.map(
      (rol) => [rol, this.calculatePermissions([rol])] as const,
    );

    // Qué aporta cada permiso especial por separado. Se prueba de a uno
    // ENCIMA de los roles: así se ve exactamente cuál destrabó qué.
    const granulares = overrides?.permisos ?? [];
    const porGranular = granulares.map(
      (id) =>
        [id, this.calculatePermissions(roles, { ...overrides, permisos: [id] })] as const,
    );

    return Object.keys(efectivos).map((clave) => {
      const valor = efectivos[clave] === true;
      if (!valor) {
        return { clave, valor: false, origen: null, detalle: null };
      }

      // Vino del rol: se nombra el primero que lo otorga.
      if (soloRoles[clave] === true) {
        const rol = porRol.find(([, p]) => p[clave] === true)?.[0];
        return {
          clave,
          valor: true,
          origen: 'rol' as const,
          detalle: rol ?? null,
        };
      }

      // No lo dan los roles ⇒ salió de un permiso especial o de un flag.
      const granular = porGranular.find(([, p]) => p[clave] === true)?.[0];
      if (granular) {
        return { clave, valor: true, origen: 'especial' as const, detalle: granular };
      }
      // No deberia llegar acá: si lo tiene y no viene ni del rol ni de un
      // granular, es que alguien agregó una fuente nueva y se olvidó de
      // reflejarla. Mejor decir "no sé" que inventar una procedencia.
      return { clave, valor: true, origen: null, detalle: null };
    });
  }

}
