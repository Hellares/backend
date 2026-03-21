import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';

export class CrearEmpresaBancoDto {
  @ApiProperty({ example: 'BCP' })
  @IsString()
  nombreBanco: string;

  @ApiProperty({ example: 'CORRIENTE' })
  @IsString()
  tipoCuenta: string;

  @ApiProperty()
  @IsString()
  numeroCuenta: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cci?: string;

  @ApiProperty({ required: false, default: 'PEN' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  titular?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  saldoActual?: number;
}

export class ActualizarEmpresaBancoDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nombreBanco?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tipoCuenta?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  numeroCuenta?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cci?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  titular?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class ActualizarSaldoDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  saldo: number;
}
