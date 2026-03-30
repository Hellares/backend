import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { AdminEmpresaFiltersDto } from './dto/admin-empresa-filters.dto';
import { AdminEmpresaUpdateDto } from './dto/admin-empresa-update.dto';
import { AdminEmpresaPlanDto } from './dto/admin-empresa-plan.dto';
import { AdminEmpresaSuscripcionDto } from './dto/admin-empresa-suscripcion.dto';
import { AdminUsuarioFiltersDto } from './dto/admin-usuario-filters.dto';
import { AdminUsuarioUpdateDto } from './dto/admin-usuario-update.dto';
import { AdminPlanUpdateDto } from './dto/admin-plan-update.dto';
import { AdminPagoFiltersDto } from './dto/admin-pago-filters.dto';
import { AdminPagoCreateDto } from './dto/admin-pago-create.dto';
import { AdminEnviarNotificacionDto, AdminEnviarUsuariosDto } from './dto/admin-notificacion.dto';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { AccionAudit } from '@prisma/client';

@ApiTags('Super Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@UseInterceptors(AuditInterceptor)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditService: AuditService,
  ) {}

  // ==========================================
  // DASHBOARD
  // ==========================================

  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboard();
  }

  // ==========================================
  // EMPRESAS
  // ==========================================

  @Get('empresas')
  async getEmpresas(@Query() filters: AdminEmpresaFiltersDto) {
    return this.adminService.getEmpresas(filters);
  }

  @Get('empresas/:id')
  async getEmpresaDetail(@Param('id') id: string) {
    return this.adminService.getEmpresaDetail(id);
  }

  @Patch('empresas/:id')
  async updateEmpresa(
    @Param('id') id: string,
    @Body() dto: AdminEmpresaUpdateDto,
  ) {
    return this.adminService.updateEmpresa(id, dto);
  }

  @Patch('empresas/:id/plan')
  async changeEmpresaPlan(
    @Param('id') id: string,
    @Body() dto: AdminEmpresaPlanDto,
  ) {
    return this.adminService.changeEmpresaPlan(id, dto);
  }

  @Patch('empresas/:id/suscripcion')
  async updateEmpresaSuscripcion(
    @Param('id') id: string,
    @Body() dto: AdminEmpresaSuscripcionDto,
  ) {
    return this.adminService.updateEmpresaSuscripcion(id, dto);
  }

  // ==========================================
  // USUARIOS
  // ==========================================

  @Get('usuarios')
  async getUsuarios(@Query() filters: AdminUsuarioFiltersDto) {
    return this.adminService.getUsuarios(filters);
  }

  @Get('usuarios/:id')
  async getUsuarioDetail(@Param('id') id: string) {
    return this.adminService.getUsuarioDetail(id);
  }

  @Patch('usuarios/:id')
  async updateUsuario(
    @Param('id') id: string,
    @Body() dto: AdminUsuarioUpdateDto,
  ) {
    return this.adminService.updateUsuario(id, dto);
  }

  // ==========================================
  // PLANES
  // ==========================================

  @Get('planes')
  async getPlanes() {
    return this.adminService.getPlanes();
  }

  @Get('planes/:id')
  async getPlanDetail(@Param('id') id: string) {
    return this.adminService.getPlanDetail(id);
  }

  @Patch('planes/:id')
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: AdminPlanUpdateDto,
  ) {
    return this.adminService.updatePlan(id, dto);
  }

  // ==========================================
  // STORAGE
  // ==========================================

  @Get('storage')
  async getStorageUsage() {
    return this.adminService.getStorageUsage();
  }

  // ==========================================
  // PAGOS DE SUSCRIPCIÓN
  // ==========================================

  @Get('pagos')
  async getPagos(@Query() filters: AdminPagoFiltersDto) {
    return this.adminService.getPagos(filters);
  }

  @Post('pagos')
  async createPago(
    @Body() dto: AdminPagoCreateDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.adminService.createPago(dto, userId);
  }

  @Patch('pagos/:id/anular')
  async anularPago(@Param('id') id: string) {
    return this.adminService.anularPago(id);
  }

  @Patch('pagos/:id/validar')
  async validarPago(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.adminService.validarPago(id, userId);
  }

  @Patch('pagos/:id/rechazar')
  async rechazarPago(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body('motivo') motivo: string,
  ) {
    return this.adminService.rechazarPago(id, userId, motivo || 'Sin motivo especificado');
  }

  @Get('ingresos')
  async getIngresosReporte(
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.adminService.getIngresosReporte(fechaDesde, fechaHasta);
  }

  // ==========================================
  // NOTIFICACIONES
  // ==========================================

  @Post('notificaciones/empresa/:id')
  async enviarAEmpresa(
    @Param('id') empresaId: string,
    @Body() dto: AdminEnviarNotificacionDto,
  ) {
    return this.adminService.enviarAEmpresa(empresaId, dto);
  }

  @Post('notificaciones/broadcast')
  async enviarBroadcast(@Body() dto: AdminEnviarNotificacionDto) {
    return this.adminService.enviarBroadcast(dto);
  }

  @Post('notificaciones/usuarios')
  async enviarAUsuarios(@Body() dto: AdminEnviarUsuariosDto) {
    return this.adminService.enviarAUsuarios(dto);
  }

  @Get('notificaciones')
  async getNotificacionesEnviadas(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getNotificacionesEnviadas(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  // ==========================================
  // CONFIGURACIÓN DEL SISTEMA
  // ==========================================

  @Get('configuracion-sistema')
  async getConfiguracionSistema() {
    return this.adminService.getConfiguracionSistema();
  }

  @Patch('configuracion-sistema')
  async updateConfiguracionSistema(@Body() data: Record<string, any>) {
    return this.adminService.updateConfiguracionSistema(data);
  }

  // ==========================================
  // MONITOR DEL SISTEMA
  // ==========================================

  @Get('monitor/health')
  async getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  @Get('monitor/stats')
  async getSystemStats() {
    return this.adminService.getSystemStats();
  }

  @Get('monitor/logs')
  async getSystemLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.adminService.getSystemLogs(
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 50,
    );
  }

  // ==========================================
  // AUDITORÍA
  // ==========================================

  @Get('audit')
  async getAuditLogs(
    @Query('usuarioId') usuarioId?: string,
    @Query('empresaId') empresaId?: string,
    @Query('accion') accion?: AccionAudit,
    @Query('entidad') entidad?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.auditService.query({
      usuarioId,
      empresaId,
      accion,
      entidad,
      fechaDesde,
      fechaHasta,
      search,
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 50,
    });
  }

  @Get('audit/stats')
  async getAuditStats() {
    return this.auditService.getStats();
  }
}
