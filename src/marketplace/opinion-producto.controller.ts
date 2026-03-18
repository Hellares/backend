import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { sanitizeInput } from '../common/utils/sanitize.util';
import { OpinionProductoService } from './opinion-producto.service';

@ApiTags('Opiniones de Producto')
@Controller()
export class OpinionProductoController {
  constructor(private readonly opinionService: OpinionProductoService) {}

  // ─── Público ───

  @Get('marketplace/productos/:productoId/opiniones')
  @ApiOperation({ summary: 'Listar opiniones de un producto' })
  listarOpiniones(
    @Param('productoId') productoId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.opinionService.listarOpiniones(
      productoId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  // ─── Autenticado ───

  @Post('marketplace/productos/:productoId/opiniones')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear opinión de producto' })
  crearOpinion(
    @Param('productoId') productoId: string,
    @CurrentUser('sub') usuarioId: string,
    @Body() body: { calificacion: number; comentario?: string; imagenes?: string[] },
  ) {
    if (!body.calificacion) throw new BadRequestException('La calificación es requerida');
    return this.opinionService.crearOpinion(
      productoId,
      usuarioId,
      body.calificacion,
      body.comentario ? sanitizeInput(body.comentario) : undefined,
      body.imagenes,
    );
  }

  // ─── Gestión empresa ───

  @Get('opiniones-producto')
  @UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Listar opiniones de productos de mi empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  listarOpinionesEmpresa(
    @Headers('x-tenant-id') empresaId: string,
    @Query('filtro') filtro?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.opinionService.listarOpinionesEmpresa(
      empresaId,
      filtro,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }
}
