import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class CrearGastoCajaChicaDto {
  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  categoriaGastoId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  comprobanteUrl?: string;
}
