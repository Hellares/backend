import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class CrearCajaChicaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  fondoFijo: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  umbralAlerta?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  responsableId: string;
}
