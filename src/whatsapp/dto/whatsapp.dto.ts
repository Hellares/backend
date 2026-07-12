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
    description: 'Apagar/encender los envíos automáticos sin desvincular',
  })
  @IsOptional()
  @IsBoolean()
  habilitado?: boolean;
}
