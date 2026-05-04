# Sistema de Permisos y Roles — Syncronize

Última revisión: 2026-05-04

Este documento describe el sistema completo de roles y permisos del SaaS:
qué hace cada capa, dónde vive cada cosa, y cómo agregar nuevas
capacidades sin romper el equilibrio.

---

## 1. Conceptos clave

El sistema combina **4 capas** que aplican en orden de generalidad:

| # | Capa | Granularidad | Almacenamiento | Para qué sirve |
|---|---|---|---|---|
| 1 | **Rol global de empresa** | Por empresa | `EmpresaUsuarioRol.rol: Rol` | Define el grueso de permisos (qué endpoints puede llamar). |
| 2 | **Rol por sede** | Por sede | `UsuarioSedeRol.rol: SedeRole` | Hoy declarativo, no usado en cálculos. Reservado para futuro. |
| 3 | **Flags individuales legacy** | Por usuario+sede | `UsuarioSedeRol.{puedeAbrirCaja,puedeCerrarCaja,limiteCreditoVenta}` | Override sobre el rol. Históricos — ahora se prefiere capa 4. |
| 4 | **Permisos granulares (catálogo)** | Por usuario+sede | `UsuarioSedeRol.permisos: String[]` | Permisos arbitrarios extensibles sin migration. |
| 5 | **Accesos rápidos ocultos** | Por usuario+sede | `UsuarioSedeRol.accesosRapidosOcultos: String[]` | Solo UI: oculta items del dashboard/drawer aunque el permiso los conceda. |

Las capas 1+3+4 las consume el **backend** para autorizar endpoints. La
capa 5 es exclusivamente del **frontend** (decisión de qué mostrar).

---

## 2. Roles disponibles

### Enum `Rol` (a nivel empresa)

`backend/prisma/schema/auth.prisma`:

```prisma
enum Rol {
  SUPER_ADMIN
  EMPRESA_ADMIN
  SEDE_ADMIN
  CAJERO
  VENDEDOR
  TECNICO
  CONTADOR
  LECTURA
  OPERADOR
  CLIENTE
}
```

**Mapeo a permisos por capacidad** (`PermissionsService.calculatePermissions`):

| | Admin (Super/Empresa/Sede) | Cajero | Vendedor | Técnico | Contador | Operador | Lectura |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Productos** ver | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Productos** gestionar | ✓ | | | | | | |
| **Servicios** ver | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| **Servicios** gestionar | ✓ | | | ✓ | | | |
| **Clientes** ver | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Clientes** gestionar | ✓ | ✓ | ✓ | | | ✓ | |
| **Ventas** ver | ✓ | ✓ | ✓ | | ✓ | | ✓ |
| **Ventas** gestionar | ✓ | ✓ | ✓ | | | | |
| **Cotizaciones** ver | ✓ | ✓ | ✓ | | ✓ | | ✓ |
| **Cotizaciones** gestionar | ✓ | | ✓ | | | | |
| **Caja** ver | ✓ | ✓ | | | ✓ | | |
| **Caja** gestionar | ✓ | ✓ | | | | | |
| **Caja Abrir/Cerrar (granular)** | ✓ | ✓ | flag/permiso | flag/permiso | | flag/permiso | |
| **Reportes** | ✓ | ✓ | | | ✓ | | ✓ |
| **Facturación** | ✓ | ✓ | | | ✓ | | |
| **Compras** | ✓ | | | | ✓ | ✓ | ✓ |
| **RRHH** | ✓ (admin) | | | | ✓ (ver) | | ✓ |
| **Configuración** | admin | | | | | | |

### Enum `SedeRole` (a nivel sede)

Existe en `auth.prisma` con 12 valores (GERENTE_SEDE, SUPERVISOR,
ALMACENERO, REPARTIDOR, etc.) pero **el `PermissionsService` actualmente
NO lo usa**. Es código declarativo para futuro — cuando se quiera
diferenciar permisos por sede del mismo usuario, este enum servirá.

---

## 3. Modelos de datos

### `EmpresaUsuarioRol`

Relación usuario ↔ empresa con rol global.

```prisma
model EmpresaUsuarioRol {
  id        String   @id @default(cuid())
  usuarioId String
  empresaId String
  rol       Rol
  isActive  Boolean  @default(true)
  estado    EstadoRolUsuario  // PENDIENTE/APROBADO/RECHAZADO
  // ...
}
```

### `UsuarioSedeRol`

Relación usuario ↔ sede con configuración granular.

```prisma
model UsuarioSedeRol {
  id                    String   @id @default(cuid())
  usuarioId             String
  sedeId                String
  rol                   SedeRole

  // Flags legacy de caja
  puedeAbrirCaja        Boolean  @default(false)
  puedeCerrarCaja       Boolean  @default(false)
  limiteCreditoVenta    Decimal?

  // Permisos extensibles (catálogo)
  permisos              String[] @default([])

  // Accesos rápidos del dashboard ocultos al usuario
  accesosRapidosOcultos String[] @default([])

  isActive  Boolean   @default(true)
  deletedAt DateTime?

  @@unique([usuarioId, sedeId])
}
```

**Importante**: el unique constraint NO filtra por `deletedAt`. Cualquier
flujo que haga soft-delete + create con la misma `(usuarioId, sedeId)`
**revienta** con P2002. Por eso `actualizarUsuario` usa **upsert** + soft-delete
de sobrantes (`backend/src/usuarios/usuarios.service.ts`).

---

## 4. Backend — flujo de autorización

### Capa 1: Decorador `@RequiresPermission`

`backend/src/auth/decorators/requires-permission.decorator.ts`

```ts
@Post()
@RequiresPermission(Permission.MANAGE_VENTAS)
async create() { ... }
```

El enum `Permission` tiene ~40 capacidades nombradas (`canViewProducts`,
`canManageVentas`, etc.) — son las capacidades **por rol**. Quien define
qué rol tiene cada permiso es `PermissionsService`.

### Capa 2: `PermissionsGuard`

`backend/src/auth/guards/permissions.guard.ts`

Para cada request:
1. Lee el `Rol` del usuario en la empresa actual (cache via `TenantAuthGuard`).
2. Carga `UsuarioSedeRol` del usuario consolidando entre todas sus sedes:
   - `puedeAbrirCaja: OR` entre sedes.
   - `puedeCerrarCaja: OR` entre sedes.
   - `permisos: union` deduplicada.
3. Llama a `PermissionsService.calculatePermissions(roles, overrides)` con los flags.
4. Verifica si el permiso requerido está en true.
5. Pone `request._granularPermissions: string[]` para uso posterior.

### Capa 3: `PermissionsService`

`backend/src/auth/services/permissions.service.ts` — **Single Source of
Truth** de los permisos por rol.

```ts
calculatePermissions(
  roles: Rol[],
  overrides?: PermissionsOverrides,
): EmpresaPermissionsDto
```

Cada permiso se calcula como booleano. Los `overrides` (flags legacy)
amplían los permisos de caja:

```ts
canAbrirCaja:  isAnyAdmin || isCajero || overrides?.puedeAbrirCaja
canCerrarCaja: isAnyAdmin || isCajero || overrides?.puedeCerrarCaja
canManageCaja: isAnyAdmin || isCajero || ...
```

### Capa 4: `hasGranularPermission` (nuevo, 2026-05-04)

```ts
hasGranularPermission(
  permisos: readonly string[],
  permId: string,
  options?: { roles?: Rol[]; overrides?: PermissionsOverrides },
): boolean
```

Chequea contra el catálogo `granular-permissions.catalog.ts` con compat
hacia los flags legacy:
- `caja.abrir` ↔ `puedeAbrirCaja`.
- `caja.cerrar` ↔ `puedeCerrarCaja`.
- Admin global → siempre true.
- Resto → presencia explícita en `permisos[]`.

**Uso típico desde un endpoint**:

```ts
@Post('ventas/descuento-libre')
async aplicarDescuento(@Req() req) {
  const ok = this.permissionsService.hasGranularPermission(
    req._granularPermissions,
    GranularPermissionId.VENTA_DESCUENTO_LIBRE,
    { roles: req._tenantRoles, overrides: ... },
  );
  if (!ok) throw new ForbiddenException();
  // ...
}
```

---

## 5. Catálogo de permisos granulares

`backend/src/auth/services/granular-permissions.catalog.ts`

**Convención de IDs**: `dominio.accion` en kebab-case
(`caja.abrir`, `venta.descuento-libre`, `producto.ver-costo`).

**Catálogo actual** (11 permisos, 6 categorías):

| ID | Categoría | Para qué |
|---|---|---|
| `caja.abrir` | Caja | Abrir caja del turno |
| `caja.cerrar` | Caja | Cerrar caja con conteo |
| `caja.movimiento-anular` | Caja | Anular ingreso/egreso de caja |
| `venta.descuento-libre` | Venta | Aplicar descuento sin autorización superior |
| `venta.anular` | Venta | Anular venta registrada |
| `venta.editar-precio` | Venta | Modificar precio al cobrar |
| `cotizacion.aprobar-grande` | Cotización | Aprobar cotización sobre el límite |
| `producto.ver-costo` | Producto | Ver el campo costo |
| `producto.editar-costo` | Producto | Modificar el costo registrado |
| `devolucion.crear` | Devolución | Registrar devolución de venta |
| `cliente.ver-credito` | Cliente | Ver línea de crédito y deuda |

**Espejo en Flutter**: `lib/core/utils/granular_permissions_catalog.dart`.
Los IDs DEBEN coincidir exactamente.

---

## 6. Accesos rápidos del dashboard

`lib/features/empresa/presentation/widgets/accesos_rapidos_section.dart`

**Catálogo de IDs estables** (`AccesosRapidosCatalogo`):

```
ventaRapida, ventaAvanzada, colaPos, ventas, cotizaciones,
caja, monitorCajas, cajaChica, cuentasPorCobrar,
finanzas, facturacion,
productos, servicios, monitorProductos,
ordenesServicio, flujoDocs, guiasRemision, config
```

**Filtro doble** en accesos rápidos del dashboard y en el drawer:

```
visible = permisoDelRol  AND  !accesosRapidosOcultos.contains(id)
```

**Items "Cuenta"** (Mi Perfil, Cambiar Empresa, Salir) **no tienen `accesoRapidoId`**
y solo se filtran por permiso del rol — siempre disponibles para el usuario.

**Items administrativos** (Categorías, Marcas, Atributos, Inventario, RRHH,
Sedes, Compras, Proveedores) tampoco tienen `accesoRapidoId` — se filtran solo
por permiso del rol (típicamente `canManageProducts` o más restrictivos).

---

## 7. Flutter — UI de gestión

### Para crear usuario

`lib/features/usuario/presentation/pages/usuario_form_page.dart`

Sección plegable con:
- Dropdown rol.
- **Botón "Aplicar configuración estándar de [rol]"** (solo si hay rol). Aplica preset.
- Switches `puedeAbrirCaja` / `puedeCerrarCaja`.
- Sección **Accesos rápidos visibles** — Wrap de checkboxes 2 cols.
- Sección **Permisos especiales** — checkboxes agrupados por categoría con tooltip de description.

### Para editar usuario

`lib/features/usuario/presentation/widgets/asignar_rol_dialog.dart`

Mismas secciones, precarga desde `widget.usuario.sedes` (consolidado entre
sedes — si tiene el permiso/oculto en alguna, se considera activo).

### Presets por rol

`lib/core/utils/rol_presets.dart` — Map `Rol → RolPreset` con defaults
para 6 roles. Cada preset declara `puedeAbrirCaja`, `puedeCerrarCaja`,
`accesosRapidosOcultos[]`, `permisosEspeciales[]`.

**Cuando el admin toca "Aplicar"**:
- Si está creando: aplicación silenciosa (todavía no hay datos del usuario).
- Si está editando: AlertDialog de confirmación ("se sobrescribirán...").

---

## 8. Recetas — cómo extender el sistema

### A. Agregar un permiso nuevo a un rol existente

Ej: "el VENDEDOR ahora puede ver compras."

1. `backend/src/auth/services/permissions.service.ts`
   ```ts
   canViewCompras: isAnyAdmin || isContador || isOperador || isViewer || isVendedor,
   ```
2. **No requiere migration**. La próxima request del vendedor verá `canViewCompras: true`.

### B. Agregar un permiso granular nuevo

Ej: "Permitir cancelar comprobantes a usuarios específicos."

1. `backend/src/auth/services/granular-permissions.catalog.ts`:
   ```ts
   { id: 'comprobante.cancelar', label: 'Cancelar comprobante', ... }
   ```
2. `backend/src/auth/services/granular-permissions.catalog.ts` — agregar constante:
   ```ts
   static readonly COMPROBANTE_CANCELAR = 'comprobante.cancelar';
   ```
3. **Espejo en Flutter** (`lib/core/utils/granular_permissions_catalog.dart`):
   ```dart
   GranularPermission(id: 'comprobante.cancelar', label: '...', ...)
   ```
   Y la constante en `GranularPermissionId`.
4. En el endpoint que lo necesita:
   ```ts
   if (!this.permissionsService.hasGranularPermission(
     req._granularPermissions, GranularPermissionId.COMPROBANTE_CANCELAR,
     { roles: req._tenantRoles, overrides: ... }
   )) throw new ForbiddenException();
   ```
5. Sin migration. El admin lo asigna desde la UI.

### C. Agregar un acceso rápido nuevo al dashboard

1. `lib/features/empresa/presentation/widgets/accesos_rapidos_section.dart`:
   - Agregar al catálogo:
     ```dart
     static const reportes = 'reportes';
     // Y al items: (reportes, 'Reportes')
     ```
   - Agregar `_AccesoItem` con su `puedeVer` (mapping a permiso del rol).
2. (Opcional) Agregarlo también al drawer en `empresa_drawer.dart` con `accesoRapidoId: AccesosRapidosCatalogo.reportes` para que respete el override del admin.
3. Sin migration. El admin lo verá en el form de usuario para tildarlo/destildarlo.

### D. Agregar un nuevo rol global

1. `backend/prisma/schema/auth.prisma` — agregar al enum `Rol`. **Migration requerida**.
2. `backend/src/auth/services/permissions.service.ts.calculatePermissions` — agregar la lógica del rol nuevo.
3. (Si aplica) `lib/core/utils/rol_presets.dart` — preset por defecto.
4. `lib/features/usuario/...` — el dropdown lee `RolUsuario.values` automáticamente; si agregás al enum del frontend, aparece.

### E. Agregar un nuevo flag legacy

**No recomendado**. Si necesitás un permiso por usuario, usá la capa 4
(catálogo granular) — no requiere migration y es extensible. Los flags
existentes (`puedeAbrirCaja`, `puedeCerrarCaja`) se mantienen por compat
hasta que se complete su migración a strings del catálogo.

---

## 9. Reglas mentales para el admin

- **"Si oculto un acceso rápido al usuario, queda oculto en TODOS lados."**
  El override del admin (`accesosRapidosOcultos`) aplica al dashboard y
  al drawer simultáneamente. No es necesario configurar dos veces.

- **"Para que un VENDEDOR maneje caja sin promoverlo a CAJERO."**
  Tildar "Puede abrir caja" + "Puede cerrar caja" en el form del usuario.
  Es flag legacy — equivalente a tener `caja.abrir` y `caja.cerrar` en el
  catálogo granular.

- **"Para autorizar a un usuario específico a hacer X que su rol no permite."**
  Buscar el permiso granular correspondiente en la sección "Permisos
  especiales" del form de usuario. Si no existe, agregarlo al catálogo
  (receta B).

- **"Los items de Cuenta (perfil, cambiar empresa, salir) nunca se ocultan."**
  Esos items no tienen `accesoRapidoId` y siempre están disponibles. El
  usuario nunca puede quedar atrapado sin cómo salir de la app.

- **"Cuentas por Cobrar y Caja Chica son visibles para admin/contador
  solamente por default."**
  Caja Chica está además en el catálogo de accesos rápidos para que el
  admin pueda otorgarla puntualmente vía override.

---

## 10. Comandos útiles para debugging

### Ver qué roles + flags tiene un usuario en una empresa

```sql
SELECT
  eur.rol AS rol_global,
  usr.rol AS rol_sede,
  s.nombre AS sede,
  usr."puedeAbrirCaja",
  usr."puedeCerrarCaja",
  usr.permisos,
  usr."accesosRapidosOcultos",
  usr."limiteCreditoVenta"
FROM "EmpresaUsuarioRol" eur
JOIN "Usuario" u ON u.id = eur."usuarioId"
LEFT JOIN "UsuarioSedeRol" usr ON usr."usuarioId" = u.id AND usr."isActive" = true AND usr."deletedAt" IS NULL
LEFT JOIN "Sede" s ON s.id = usr."sedeId"
WHERE u.email = '<email>' AND eur."empresaId" = '<empresaId>';
```

### Forzar permiso granular a un usuario sin pasar por la UI

```sql
UPDATE "UsuarioSedeRol"
SET permisos = ARRAY['caja.abrir', 'venta.descuento-libre']
WHERE "usuarioId" = '<id>' AND "sedeId" = '<sedeId>';
```

### Ver request de un endpoint y cómo se calculan los permisos

Logs del backend en beta:
```bash
ssh root@<vps> "docker logs --tail 100 syncronize-backend-beta"
```

Buscar `❌ Forbidden` o `❌ Prisma Error` para fallos de permiso.

---

## 11. Roadmap — mejoras sugeridas (no implementadas)

### Prioridad alta cuando aparezca el caso

1. **Audit log de cambios de permisos**. Tabla `UsuarioPermisosLog` con
   quien + cuando + qué cambió. Crítico para clientes con compliance o
   investigaciones post-incidente.
2. **Permisos por sede específica (validación a nivel servicio)**. Hoy
   `puedeAbrirCaja` aplica si está en cualquier sede. Si el cliente tiene
   3 sedes y quiere autorizar caja solo en una, el guard concede pero el
   service `abrirCaja(sedeId)` debería re-validar el flag en esa sede
   específica.
3. **Permisos denegados (`deny`)**. Array `permisosDenegados: String[]`
   que sobreescribe lo que el rol concede. Útil para "este vendedor NO
   puede aplicar descuentos aunque su rol normalmente sí." Regla deny-wins.

### Prioridad media — para evolución a enterprise

4. **Roles personalizados por empresa**. Tabla `RolPersonalizado` por
   empresa con array de permisos. Cada empresa crea sus propios roles
   ("Encargado de Turno", "Auxiliar Senior", etc.). Refactor grande.
5. **Limpieza de SedeRole**. El enum tiene 12 valores que nadie usa en
   cálculos. Decidir: usarlo en `PermissionsService` (con sede contextual),
   o deprecar.
6. **Migración completa de flags legacy a granulares**. Migrar
   `puedeAbrirCaja` → `caja.abrir` en `permisos[]` de todos los registros
   existentes. Eliminar las columnas. Reduce código path duplicado.

### Prioridad baja — polish

7. **UI de presets editables por empresa**. Hoy los presets están
   hardcoded en `rol_presets.dart`. Permitir que el admin de cada empresa
   los personalice (tabla `EmpresaRolPreset`).
8. **Bulk edit de permisos**. Asignar permisos a múltiples usuarios a la
   vez (típico cuando se agrega un permiso nuevo y se quiere darlo a todo
   el equipo).
9. **Permisos por proyecto/cliente**. Para tipos de empresa que separan
   operaciones por cliente final (ej. agencias).

---

## 12. Archivos clave (referencias rápidas)

### Backend

| Archivo | Para qué |
|---|---|
| `prisma/schema/auth.prisma` | Schema EmpresaUsuarioRol, UsuarioSedeRol, enums Rol/SedeRole |
| `src/auth/enums/permission.enum.ts` | Enum Permission con ~40 capacidades |
| `src/auth/services/permissions.service.ts` | Source of Truth — cálculo de permisos por rol + overrides |
| `src/auth/services/granular-permissions.catalog.ts` | Catálogo de permisos granulares extensibles |
| `src/auth/guards/permissions.guard.ts` | Guard que aplica @RequiresPermission |
| `src/auth/decorators/requires-permission.decorator.ts` | Decorator |
| `src/empresa/dto/empresa-permissions.dto.ts` | DTO con todos los flags expuestos al cliente |
| `src/usuarios/dto/{create,update}-usuario.dto.ts` | DTOs de creación/edición |
| `src/usuarios/usuarios.service.ts` | Persistencia (crear, actualizar con upsert por sede) |

### Flutter

| Archivo | Para qué |
|---|---|
| `lib/core/utils/granular_permissions_catalog.dart` | Espejo del catálogo backend |
| `lib/core/utils/rol_presets.dart` | Presets por rol (defaults aplicables) |
| `lib/features/empresa/domain/entities/empresa_permissions.dart` | Entidad con todos los permisos |
| `lib/features/empresa/data/models/empresa_permissions_model.dart` | Serialización JSON |
| `lib/features/empresa/presentation/widgets/accesos_rapidos_section.dart` | Catálogo de accesos rápidos + filtro doble |
| `lib/features/empresa/presentation/widgets/empresa_drawer.dart` | Drawer con filtros por permiso + accesoRapidoId |
| `lib/features/usuario/presentation/pages/usuario_form_page.dart` | Form crear (con sección de presets, accesos, granulares) |
| `lib/features/usuario/presentation/widgets/asignar_rol_dialog.dart` | Dialog editar rol/permisos |
| `lib/features/usuario/domain/entities/usuario.dart` | Entidad UsuarioSede con permisos[] y accesosRapidosOcultos |

---

## 13. Histórico de cambios (commits relevantes)

| Hash | Cambio |
|---|---|
| `c21e70b` | Permisos granulares de caja con override (`puedeAbrirCaja`/`puedeCerrarCaja` ahora funcionan) |
| `2c2caf8` | `accesosRapidosOcultos` por usuario (schema + persist + DTO) |
| `ddd1bc9` | Fix: `actualizarUsuario` persiste `accesosRapidosOcultos` |
| `ad381a0` | Fix: `actualizarUsuario` usa upsert por sede (evita unique constraint P2002) |
| `b6c6cc8` | Catálogo granular extensible vía `UsuarioSedeRol.permisos` |

Migrations:
- `20260504070000_add_accesos_rapidos_ocultos_to_usuario_sede_rol`
