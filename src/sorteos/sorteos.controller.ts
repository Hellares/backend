import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EstadoSorteo } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SorteosService } from './sorteos.service';
import {
  ActualizarPremioCatalogoDto,
  CambiarEstadoParticipanteDto,
  CambiarEstadoPremioDto,
  CantarBolillaDto,
  CrearPremioCatalogoDto,
  CreateSorteoDto,
  EditarEntregaPremioDto,
  ElegirAgenciaPremioDto,
  JugarTicketDto,
  RegistrarPremioDto,
  UpdateSorteoDto,
} from './dto/sorteo.dto';

/** Gestión de sorteos y premios — lado EMPRESA. */
@ApiTags('Sorteos - Empresa')
@Controller('sorteos')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SorteosEmpresaController {
  constructor(private readonly service: SorteosService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Crear un sorteo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: CreateSorteoDto,
  ) {
    return this.service.crearSorteo(empresaId, usuarioId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Listar sorteos de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estado') estado?: EstadoSorteo,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listarSorteos(empresaId, {
      estado,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  // OJO: rutas estáticas ANTES de ':id' (Nest matchea en orden de
  // declaración — mismo gotcha que pedidos-marketplace).
  @Patch('premios/:premioId/estado')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary: 'Cambiar estado del premio (ANULADO repone stock)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cambiarEstadoPremio(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('premioId') premioId: string,
    @Body() dto: CambiarEstadoPremioDto,
  ) {
    return this.service.cambiarEstadoPremio(
      empresaId,
      usuarioId,
      premioId,
      dto,
    );
  }

  @Patch('premios/:premioId/entrega')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Corregir la entrega del premio (modalidad y/o agencia) — solo antes del despacho',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async editarEntregaPremio(
    @Headers('x-tenant-id') empresaId: string,
    @Param('premioId') premioId: string,
    @Body() dto: EditarEntregaPremioDto,
  ) {
    return this.service.editarEntregaPremio(empresaId, premioId, dto);
  }

  @Post('premios/:premioId/ticket-envio')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary: 'Subir foto del ticket de envío de agencia (contexto forzado)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @UseInterceptors(FileInterceptor('file'))
  async subirTicket(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('premioId') premioId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    return this.service.subirTicketEnvio(empresaId, usuarioId, premioId, file);
  }

  @Patch('premios/:premioId/rotulo-impreso')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Marcar el rótulo de envío como impreso' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async marcarRotuloImpreso(
    @Headers('x-tenant-id') empresaId: string,
    @Param('premioId') premioId: string,
  ) {
    return this.service.marcarRotuloImpreso(empresaId, premioId);
  }

  @Post('premios/:premioId/foto-premio')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Subir foto del premio ganado' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @UseInterceptors(FileInterceptor('file'))
  async subirFotoPremio(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('premioId') premioId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    return this.service.subirFotoPremio(empresaId, usuarioId, premioId, file);
  }

  @Post(':id/imagen')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Subir imagen promocional del sorteo' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @UseInterceptors(FileInterceptor('file'))
  async subirImagenSorteo(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('id') sorteoId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    return this.service.subirImagenSorteo(
      empresaId,
      usuarioId,
      sorteoId,
      file,
    );
  }

  @Get('ganadores/ultima-entrega')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Última entrega por agencia de un DNI (prellenado de ganadores repetidos) — null si no tiene',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async ultimaEntregaGanador(
    @Headers('x-tenant-id') empresaId: string,
    @Query('dni') dni: string,
  ) {
    return this.service.ultimaEntregaGanador(empresaId, dni);
  }

  @Get('participantes/pendientes')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({
    summary:
      'Cola global: participantes con pago por validar (sorteos abiertos)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async participantesPendientes(@Headers('x-tenant-id') empresaId: string) {
    return this.service.listarParticipantesPendientes(empresaId);
  }

  @Patch('participantes/:id/estado')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Valida/rechaza un participante del bot (ACTIVO asigna ticket, confirma por WhatsApp y en DINAMICAS crea el premio automatico)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cambiarEstadoParticipante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') participanteId: string,
    @Body() dto: CambiarEstadoParticipanteDto,
    @CurrentUser() user: any,
  ) {
    return this.service.cambiarEstadoParticipante(
      empresaId,
      user.sub,
      participanteId,
      dto.estado,
    );
  }

  // ── Catálogo de premios de la rifa (ánfora) ──────────────────────────

  @Patch('premios-catalogo/:catalogoId')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Editar un premio del catálogo (si no se sorteó)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizarPremioCatalogo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('catalogoId') catalogoId: string,
    @Body() dto: ActualizarPremioCatalogoDto,
  ) {
    return this.service.actualizarPremioCatalogo(empresaId, catalogoId, dto);
  }

  @Delete('premios-catalogo/:catalogoId')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Eliminar un premio del catálogo (si no se sorteó)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async eliminarPremioCatalogo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('catalogoId') catalogoId: string,
  ) {
    return this.service.eliminarPremioCatalogo(empresaId, catalogoId);
  }

  @Post('premios-catalogo/:catalogoId/imagen')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Subir imagen del premio del catálogo (opcional)' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @UseInterceptors(FileInterceptor('file'))
  async subirImagenPremioCatalogo(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('catalogoId') catalogoId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    return this.service.subirImagenPremioCatalogo(
      empresaId,
      usuarioId,
      catalogoId,
      file,
    );
  }

  @Post(':id/premios-catalogo')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Agregar un premio al catálogo de la rifa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearPremioCatalogo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') sorteoId: string,
    @Body() dto: CrearPremioCatalogoDto,
  ) {
    return this.service.crearPremioCatalogo(empresaId, sorteoId, dto);
  }

  @Post(':id/bolillas')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'BINGO jugando: cantar una bolilla — marca todas las cartillas y devuelve los logros nuevos (línea/bingo)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cantarBolilla(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') sorteoId: string,
    @Body() dto: CantarBolillaDto,
  ) {
    return this.service.registrarBolilla(empresaId, sorteoId, dto.numero);
  }

  @Post(':id/jugar')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Salió un ticket del ánfora: adjudicar un premio del catálogo (solo sorteo CERRADO)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async jugarTicket(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('id') sorteoId: string,
    @Body() dto: JugarTicketDto,
  ) {
    return this.service.jugarTicket(empresaId, usuarioId, sorteoId, dto);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Detalle del sorteo con premios y tickets' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detalle(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') sorteoId: string,
  ) {
    return this.service.obtenerSorteo(empresaId, sorteoId);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Editar sorteo (título, canal, cerrar, etc.)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') sorteoId: string,
    @Body() dto: UpdateSorteoDto,
  ) {
    return this.service.actualizarSorteo(empresaId, sorteoId, dto);
  }

  @Post(':id/premios')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Registrar ganador + premio (descuenta stock si trae producto/variante)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarPremio(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('id') sorteoId: string,
    @Body() dto: RegistrarPremioDto,
  ) {
    return this.service.registrarPremio(empresaId, usuarioId, sorteoId, dto);
  }
}

/** "Mis Premios" — lado CLIENTE del app (cross-empresa, solo JWT). */
@ApiTags('Marketplace - Mis Premios')
@Controller('marketplace')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MisPremiosController {
  constructor(private readonly service: SorteosService) {}

  @Get('mis-premios')
  @ApiOperation({ summary: 'Premios ganados por el cliente autenticado' })
  async misPremios(@CurrentUser('sub') usuarioId: string) {
    return this.service.misPremios(usuarioId);
  }

  @Get('mis-premios/:id')
  @ApiOperation({ summary: 'Detalle de un premio propio' })
  async miPremio(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') premioId: string,
  ) {
    return this.service.miPremioDetalle(usuarioId, premioId);
  }

  @Patch('mis-premios/:id/agencia')
  @ApiOperation({
    summary:
      'El ganador indica su agencia de recojo (solo antes del despacho)',
  })
  async elegirAgencia(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') premioId: string,
    @Body() dto: ElegirAgenciaPremioDto,
  ) {
    return this.service.elegirAgenciaMiPremio(usuarioId, premioId, dto);
  }
}
