import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * Abrir bultos cerrados.
 *
 * `varianteId` es SIEMPRE la variante CERRADA (el saco): es la que sabe en
 * qué se convierte y cuánto rinde. El destino sale de su configuración, no
 * del request, para que no se pueda mandar stock a una variante arbitraria.
 */
export class AbrirBultoDto {
  @ApiProperty({ description: 'ID de la variante CERRADA (el bulto que se abre)' })
  @IsString()
  @IsNotEmpty()
  varianteId: string;

  @ApiProperty({ description: 'ID de la sede donde está el stock' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ description: 'Cuántos bultos abrir', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  cantidad: number;

  @ApiProperty({ required: false, description: 'Observaciones para el kardex' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}

/**
 * Rearmar bultos: la operación inversa.
 *
 * `varianteId` sigue siendo la variante CERRADA — es la misma relación leída
 * al revés, no una configuración aparte.
 */
export class CerrarBultoDto extends AbrirBultoDto {}
