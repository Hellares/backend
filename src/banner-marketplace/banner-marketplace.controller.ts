import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BannerMarketplaceService } from './banner-marketplace.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  ActualizarBannerDto,
  ActualizarLottieFondoDto,
  CrearLottieFondoDto,
} from './dto/banner-marketplace.dto';

/** Endpoints PÚBLICOS del banner (slider del home del marketplace). */
@ApiTags('Marketplace')
@Public()
@Controller('marketplace')
export class MarketplaceBannerPublicController {
  constructor(private readonly service: BannerMarketplaceService) {}

  @Get('banners')
  @ApiOperation({ summary: 'Banners del slider del home (empresas con plan vigente)' })
  async getBanners() {
    return this.service.bannersPublicos();
  }

  @Get('lottie-fondos')
  @ApiOperation({ summary: 'Catálogo de fondos Lottie activos' })
  async getLottieFondos() {
    return this.service.lottieFondos();
  }

  @Post('banners/:id/impresion')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registrar impresión del banner (métricas)' })
  async registrarImpresion(@Param('id') id: string) {
    return this.service.registrarEvento(id, 'IMPRESION');
  }

  @Post('banners/:id/tap')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registrar tap del banner (métricas)' })
  async registrarTap(@Param('id') id: string) {
    return this.service.registrarEvento(id, 'TAP');
  }
}

/** Gestión del banner por la EMPRESA (solo administradores de la empresa). */
@ApiTags('Banner Marketplace')
@Controller('empresas')
export class EmpresaBannerController {
  constructor(private readonly service: BannerMarketplaceService) {}

  @Get(':id/banner-marketplace')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Banner de la empresa + estado de la característica' })
  async getBanner(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getBanner(id, user.sub);
  }

  @Put(':id/banner-marketplace')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear/actualizar el banner de la empresa' })
  async upsertBanner(
    @Param('id') id: string,
    @Body() dto: ActualizarBannerDto,
    @CurrentUser() user: any,
  ) {
    return this.service.upsertBanner(id, user.sub, dto);
  }
}

/** Catálogo LottieFondo (solo SUPER ADMIN de la plataforma). */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin/lottie-fondos')
export class AdminLottieFondoController {
  constructor(private readonly service: BannerMarketplaceService) {}

  @Get()
  @ApiOperation({ summary: 'Listar catálogo completo (incluye inactivos)' })
  async listar() {
    return this.service.adminListarLotties();
  }

  @Post()
  @ApiOperation({ summary: 'Agregar fondo Lottie al catálogo' })
  async crear(@Body() dto: CrearLottieFondoDto) {
    return this.service.adminCrearLottie(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar fondo Lottie' })
  async actualizar(@Param('id') id: string, @Body() dto: ActualizarLottieFondoDto) {
    return this.service.adminActualizarLottie(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar fondo Lottie (banners quedan sin fondo)' })
  async eliminar(@Param('id') id: string) {
    return this.service.adminEliminarLottie(id);
  }
}
