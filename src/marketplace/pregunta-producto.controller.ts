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
import { PreguntaProductoService } from './pregunta-producto.service';

@ApiTags('Preguntas de Producto')
@Controller()
export class PreguntaProductoController {
  constructor(private readonly preguntaService: PreguntaProductoService) {}

  // ─── Público ───

  @Get('marketplace/productos/:productoId/preguntas')
  @ApiOperation({ summary: 'Listar preguntas y respuestas de un producto' })
  listarPreguntas(
    @Param('productoId') productoId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.preguntaService.listarPreguntas(
      productoId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  // ─── Autenticado (cliente pregunta) ───

  @Post('marketplace/productos/:productoId/preguntas')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Hacer una pregunta sobre un producto' })
  hacerPregunta(
    @Param('productoId') productoId: string,
    @CurrentUser('sub') usuarioId: string,
    @Body('pregunta') pregunta: string,
  ) {
    if (!pregunta?.trim()) throw new BadRequestException('La pregunta no puede estar vacía');
    return this.preguntaService.hacerPregunta(productoId, usuarioId, sanitizeInput(pregunta));
  }

  // ─── Empresa responde ───

  @Post('marketplace/productos/:productoId/preguntas/:preguntaId/responder')
  @UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Responder una pregunta de producto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  responderPregunta(
    @Param('productoId') productoId: string,
    @Param('preguntaId') preguntaId: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Body('respuesta') respuesta: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    if (!respuesta?.trim()) throw new BadRequestException('La respuesta no puede estar vacía');
    return this.preguntaService.responderPregunta(
      empresaId, productoId, preguntaId, usuarioId, sanitizeInput(respuesta),
    );
  }

  // ─── Gestión empresarial ───

  @Get('preguntas-producto')
  @UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Listar preguntas de productos de mi empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  listarPreguntasEmpresa(
    @Headers('x-tenant-id') empresaId: string,
    @Query('filtro') filtro?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.preguntaService.listarPreguntasEmpresa(
      empresaId,
      (filtro as any) ?? 'todas',
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }
}
