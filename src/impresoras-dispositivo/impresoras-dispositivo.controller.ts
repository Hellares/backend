import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { ImpresorasDispositivoService } from './impresoras-dispositivo.service';
import { GuardarImpresorasDto } from './dto/guardar-impresoras.dto';

@ApiTags('Impresoras por dispositivo')
@Controller('impresoras-dispositivo')
@UseGuards(JwtAuthGuard, TenantAuthGuard)
@ApiBearerAuth()
export class ImpresorasDispositivoController {
  constructor(private readonly service: ImpresorasDispositivoService) {}

  @Get(':deviceId')
  @ApiOperation({ summary: 'Config de impresoras guardada para un dispositivo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async obtener(
    @Headers('x-tenant-id') empresaId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.service.obtener(empresaId, deviceId);
  }

  @Put(':deviceId')
  @ApiOperation({ summary: 'Guardar (reemplazar) la config de impresoras del dispositivo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async guardar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: GuardarImpresorasDto,
  ) {
    return this.service.guardar(empresaId, deviceId, body.config);
  }
}
