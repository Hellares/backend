import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class AbrirCajaDto {
  @ApiProperty()
  @IsString()
  sedeId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  montoApertura: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({ required: false, description: 'Sede/RUC emisor por defecto para facturación' })
  @IsOptional()
  @IsString()
  sedeFacturacionId?: string;
}
