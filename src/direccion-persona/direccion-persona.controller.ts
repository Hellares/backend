import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DireccionPersonaService } from './direccion-persona.service';

@ApiTags('Mis Direcciones')
@Controller('mis-direcciones')
@UseGuards(JwtAuthGuard)
export class DireccionPersonaController {
  constructor(private readonly service: DireccionPersonaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar mis direcciones' })
  listar(@CurrentUser() user: any) {
    return this.service.listar(user.personaId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear dirección' })
  crear(
    @CurrentUser() user: any,
    @Body() body: any,
  ) {
    if (!body.direccion?.trim()) throw new BadRequestException('La dirección es requerida');
    return this.service.crear(user.personaId, body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar dirección' })
  actualizar(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.actualizar(user.personaId, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar dirección' })
  eliminar(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.eliminar(user.personaId, id);
  }

  @Patch(':id/predeterminada')
  @ApiOperation({ summary: 'Marcar dirección como predeterminada' })
  marcarPredeterminada(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.marcarPredeterminada(user.personaId, id);
  }
}
