import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PromocionService } from './promocion.service';
import { CrearCampanaDto } from './dto/crear-campana.dto';

@ApiTags('Promociones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('promociones')
export class PromocionController {
  constructor(private readonly promocionService: PromocionService) {}

  @Post('campana')
  @ApiOperation({ summary: 'Crear y enviar campaña de promoción' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearCampana(
    @Body() dto: CrearCampanaDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.promocionService.crearCampana(empresaId, user.sub, dto);
  }

  @Get('campanas')
  @ApiOperation({ summary: 'Listar campañas de promoción' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarCampanas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.promocionService.listarCampanas(
      empresaId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get('productos-en-oferta')
  @ApiOperation({ summary: 'Productos en oferta disponibles para campaña' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getProductosEnOferta(
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.promocionService.getProductosEnOferta(empresaId);
  }
}
