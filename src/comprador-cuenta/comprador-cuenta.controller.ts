import { Body, Controller, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { CompradorCuentaService } from './comprador-cuenta.service';
import { ConfirmarCompradorDto, DniCompradorDto, EnviarCodigoCompradorDto } from './dto/comprador-cuenta.dto';

/**
 * Cuenta del comprador de la tienda web: todo arranca por el DNI y la cuenta
 * se toma probando el celular con un código por WhatsApp. Públicos y con
 * tope de intentos: `estado` dice si un DNI es cliente (con el celular
 * enmascarado).
 */
@ApiTags('Comprador (tienda web)')
@Controller('auth/comprador')
@Public()
@UseGuards(ThrottlerGuard)
export class CompradorCuentaController {
  constructor(private readonly service: CompradorCuentaService) {}

  @Post('estado')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Qué pasa con este DNI: NUEVO, ACTIVA, POR_ACTIVAR o SIN_CONTACTO' })
  estado(@Body() dto: DniCompradorDto) {
    return this.service.estado(dto.dni);
  }

  @Post('enviar-codigo')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Envía el código por WhatsApp (al celular registrado, o al escrito si el DNI es nuevo)' })
  enviarCodigo(@Body() dto: EnviarCodigoCompradorDto) {
    return this.service.enviarCodigo(dto.dni, dto.celular);
  }

  @Post('confirmar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Valida el código, crea/activa la cuenta o cambia la contraseña, y abre la sesión' })
  confirmar(@Body() dto: ConfirmarCompradorDto, @Request() req) {
    return this.service.confirmar(dto, req);
  }
}
