import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CuentasPorPagarService } from './cuentas-por-pagar.service';
import { QueryCuentasPagarDto } from './dto/query-cuentas-pagar.dto';
import { RegistrarPagoCuentaPagarDto } from './dto/registrar-pago.dto';

@ApiTags('Cuentas por Pagar')
@Controller('cuentas-por-pagar')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CuentasPorPagarController {
  constructor(private readonly service: CuentasPorPagarService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Listar cuentas por pagar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryCuentasPagarDto,
  ) {
    return this.service.listar(empresaId, query);
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Resumen de cuentas por pagar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getResumen(empresaId);
  }

  @Get('por-proveedor')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Deuda agrupada por proveedor' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async porProveedor(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getPorProveedor(empresaId);
  }

  @Get(':compraId/detalle')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Detalle de una cuenta por pagar (ítems + historial de pagos)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detalle(
    @Headers('x-tenant-id') empresaId: string,
    @Param('compraId') compraId: string,
  ) {
    return this.service.getDetalle(empresaId, compraId);
  }

  @Post(':compraId/pago')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Registrar pago a proveedor' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('compraId') compraId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: RegistrarPagoCuentaPagarDto,
  ) {
    return this.service.registrarPago(empresaId, compraId, usuarioId, body);
  }

  @Post('comprobante')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Subir comprobante (voucher) a S3 — para mandar su URL al registrar el pago' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  subirComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
    @UploadedFile() file: any,
  ) {
    return this.service.subirComprobante(empresaId, usuarioId, file);
  }

  @Post('pagos/:pagoId/anular')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Anular un pago a proveedor (revierte el egreso y devuelve el saldo)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anularPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('pagoId') pagoId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: { motivo?: string },
  ) {
    return this.service.anularPago(empresaId, pagoId, usuarioId, body?.motivo);
  }

  @Post('pagos/:pagoId/comprobante')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Adjuntar comprobante (voucher) a un pago ya registrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  adjuntarComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('pagoId') pagoId: string,
    @CurrentUser('id') usuarioId: string,
    @UploadedFile() file: any,
  ) {
    return this.service.adjuntarComprobantePago(empresaId, pagoId, usuarioId, file);
  }
}
