import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EstadoRepartidorSyncronize } from '@prisma/client';
import { RepartidoresService } from './repartidores.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import {
  ActualizarPerfilRepartidorDto,
  RegistroRepartidorDto,
  ResolverAprobacionDto,
  VerificarOtpDto,
} from './dto/repartidores.dto';

/**
 * Repartidores freelance de Syncronize. El registro es PÚBLICO (crea la
 * cuenta); el resto requiere sesión. La administración es solo del super
 * admin de la plataforma (guard a nivel de servicio).
 */
@ApiTags('Repartidores Syncronize')
@Controller('repartidores')
export class RepartidoresController {
  constructor(private readonly service: RepartidoresService) {}

  /** Registro público: DNI validado en RENIEC + cuenta + perfil PENDIENTE. */
  @Post('registro')
  @ApiOperation({ summary: 'Registrarse como repartidor freelance' })
  registrar(@Body() dto: RegistroRepartidorDto) {
    return this.service.registrar(dto);
  }

  @Post('otp/enviar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reenviar OTP de verificación al celular' })
  enviarOtp(@CurrentUser() user: any) {
    return this.service.enviarOtp(user.sub);
  }

  @Post('otp/verificar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verificar el celular con el código OTP' })
  verificarOtp(@Body() dto: VerificarOtpDto, @CurrentUser() user: any) {
    return this.service.verificarOtp(user.sub, dto.codigo);
  }

  @Get('mi-perfil')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mi perfil de repartidor (estado incluido)' })
  miPerfil(@CurrentUser() user: any) {
    return this.service.miPerfil(user.sub);
  }

  @Put('mi-perfil')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar mi perfil (selfie, placa, zonas, docs)' })
  actualizarPerfil(
    @Body() dto: ActualizarPerfilRepartidorDto,
    @CurrentUser() user: any,
  ) {
    return this.service.actualizarPerfil(user.sub, dto);
  }

  // ── Super admin ──

  @Get('admin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar repartidores (filtro por estado)' })
  listar(
    @Query('estado') estado: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.service.listar(
      user.sub,
      estado ? (estado as EstadoRepartidorSyncronize) : undefined,
    );
  }

  @Post('admin/:id/aprobar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Aprobar repartidor (avisa por WhatsApp)' })
  aprobar(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.aprobar(user.sub, id);
  }

  @Post('admin/:id/suspender')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspender repartidor' })
  suspender(
    @Param('id') id: string,
    @Body() dto: ResolverAprobacionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.suspender(user.sub, id, dto.motivo);
  }
}
