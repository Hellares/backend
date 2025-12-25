import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../guards/permissions.guard';
import { Permission } from '../enums/permission.enum';

// Re-exportar Permission para facilitar su uso
export { Permission };

/**
 * Decorador para especificar el permiso requerido en un endpoint
 *
 * Uso:
 * @UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
 * @RequiresPermission(Permission.MANAGE_PRODUCTS)
 * @Post()
 * create() { ... }
 *
 * Permisos disponibles (enum Permission):
 * - Permission.MANAGE_USERS
 * - Permission.MANAGE_PRODUCTS
 * - Permission.MANAGE_SERVICES
 * - Permission.MANAGE_SEDES
 * - Permission.VIEW_REPORTS
 * - Permission.MANAGE_INVOICES
 * - Permission.MANAGE_ORDERS
 * - Permission.VIEW_STATISTICS
 * - Permission.MANAGE_SETTINGS
 * - Permission.MANAGE_PAYMENT_METHODS
 * - Permission.CHANGE_PLAN
 */
export const RequiresPermission = (permission: Permission) =>
  SetMetadata(PERMISSIONS_KEY, permission);
