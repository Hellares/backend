import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AperturaBultoService } from './apertura-bulto.service';
import { AbrirBultoDto, CerrarBultoDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Apertura de bultos (saco cerrado ↔ granel)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('apertura-bulto')
export class AperturaBultoController {
  constructor(private readonly service: AperturaBultoService) {}

  @Get('disponibles')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Bultos abribles en una sede',
    description:
      'Lista las variantes configuradas para abrirse, con el stock de bultos ' +
      'cerrados y el de la variante suelta. Incluye `destinoBajoMinimo` para ' +
      'que la alerta de stock pueda distinguir "abrí un saco" de "comprale al ' +
      'proveedor".',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async disponibles(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId: string,
  ) {
    return this.service.listarDisponibles(empresaId, sedeId);
  }

  @Post('abrir')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Abrir bultos cerrados',
    description:
      'Descuenta N bultos de la variante cerrada y suma N × rendimiento a la ' +
      'variante a granel, moviendo el costo por promedio ponderado. Requiere ' +
      'rol de gerencia.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async abrir(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: AbrirBultoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.abrir(empresaId, dto, user.sub);
  }

  @Post('cerrar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Rearmar bultos',
    description:
      'Operación inversa: descuenta N × rendimiento del granel y devuelve N ' +
      'bultos cerrados. Falla si no queda granel suficiente — un bulto del que ' +
      'ya se vendió parte no vuelve.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cerrar(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CerrarBultoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.cerrar(empresaId, dto, user.sub);
  }
}
