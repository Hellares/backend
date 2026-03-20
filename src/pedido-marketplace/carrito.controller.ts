import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CarritoService } from './carrito.service';
import { AgregarCarritoDto, ActualizarCantidadDto } from './dto/carrito.dto';

@ApiTags('Marketplace - Carrito')
@Controller('marketplace/carrito')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CarritoController {
  constructor(private readonly carritoService: CarritoService) {}

  @Get()
  @ApiOperation({ summary: 'Ver mi carrito agrupado por empresa' })
  async getCarrito(@CurrentUser('sub') usuarioId: string) {
    return this.carritoService.getCarrito(usuarioId);
  }

  @Get('contador')
  @ApiOperation({ summary: 'Obtener cantidad de items en carrito (para badge)' })
  async getContador(@CurrentUser('sub') usuarioId: string) {
    return this.carritoService.getContador(usuarioId);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar producto al carrito' })
  async agregarItem(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: AgregarCarritoDto,
  ) {
    return this.carritoService.agregarItem(usuarioId, dto);
  }

  @Put(':itemId')
  @ApiOperation({ summary: 'Actualizar cantidad de un item' })
  async actualizarCantidad(
    @CurrentUser('sub') usuarioId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ActualizarCantidadDto,
  ) {
    return this.carritoService.actualizarCantidad(usuarioId, itemId, dto.cantidad);
  }

  @Delete(':itemId')
  @ApiOperation({ summary: 'Eliminar un item del carrito' })
  async eliminarItem(
    @CurrentUser('sub') usuarioId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.carritoService.eliminarItem(usuarioId, itemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Vaciar todo el carrito' })
  async vaciarCarrito(@CurrentUser('sub') usuarioId: string) {
    return this.carritoService.vaciarCarrito(usuarioId);
  }

  @Get('opciones-envio/:empresaId')
  @ApiOperation({ summary: 'Obtener opciones de envío de una empresa' })
  async opcionesEnvio(@Param('empresaId') empresaId: string) {
    return this.carritoService.getOpcionesEnvio(empresaId);
  }
}
