import { IsString, IsNotEmpty, IsInt, IsOptional, IsArray, IsNumber, Min, Max, MinLength, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearNotaItemDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) descripcion: string;
  @ApiProperty() @IsNumber() @Min(0.01) @Max(999999) @Type(() => Number) cantidad: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(9999999.99) @Type(() => Number) valorUnitario: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(9999999.99) @Type(() => Number) precioUnitario: number;
  @ApiPropertyOptional() @IsOptional() @IsString() tipoAfectacion?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) igv?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) subtotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Type(() => Number) total?: number;
}

export class CrearNotaDto {
  @ApiProperty({ description: 'ID de la sede (para series)' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ description: 'Tipo de nota (SUNAT)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(13)
  @Type(() => Number)
  tipoNota: number;

  @ApiProperty({ description: 'Motivo de la nota' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(250)
  motivo: string;

  @ApiPropertyOptional({ description: 'Items de la nota (si es parcial). Si vacío, copia todos del original.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrearNotaItemDto)
  items?: CrearNotaItemDto[];
}
