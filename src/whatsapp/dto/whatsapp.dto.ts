import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWhatsappDto {
  @ApiPropertyOptional({
    description:
      'Plantilla del mensaje "premio enviado". Variables: {saludo} {ganador} ' +
      '{premio} {agencia} {destino} {orden} {codigo} {clave} {empresa}. ' +
      'Cadena vacía = volver a la plantilla default.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaPremio?: string;

  @ApiPropertyOptional({
    description:
      'Plantilla de las instrucciones de pago del bot. Variables: ' +
      "{monto} {numero} {empresa}. Cadena vacía = volver a la default.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  plantillaPago?: string;

  @ApiPropertyOptional({
    description:
      'Agencia con la que la empresa hace TODOS los envíos — el bot la ' +
      "informa y no pregunta. '' = volver al default (SHALOM).",
    example: 'SHALOM',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  agenciaEnvio?: string;

  @ApiPropertyOptional({
    description: 'Apagar/encender los envíos automáticos sin desvincular',
  })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
