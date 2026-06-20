import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CuentasRecaudacionService } from './cuentas-recaudacion.service';
import { SetCuentaRecaudacionDto } from './dto/set-cuenta-recaudacion.dto';

@ApiTags('Cuentas de Recaudación')
@Controller('cuentas-recaudacion')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CuentasRecaudacionController {
  constructor(private readonly service: CuentasRecaudacionService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Mapeo método→cuenta de recaudación de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(@Headers('x-tenant-id') empresaId: string) {
    return this.service.listar(empresaId);
  }

  @Put(':metodoPago')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Asignar la cuenta bancaria de un método de recaudación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async set(
    @Headers('x-tenant-id') empresaId: string,
    @Param('metodoPago') metodoPago: string,
    @Body() body: SetCuentaRecaudacionDto,
  ) {
    return this.service.set(empresaId, metodoPago, body.bancoId);
  }

  @Delete(':metodoPago')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Quitar la cuenta de recaudación de un método' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('metodoPago') metodoPago: string,
  ) {
    return this.service.remove(empresaId, metodoPago);
  }
}
