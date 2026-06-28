import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { MetodoPagoVenta, FuenteIngreso } from '@prisma/client';

export class RegistrarAbonoDto {
  @ApiProperty({ enum: MetodoPagoVenta })
  @IsEnum(MetodoPagoVenta)
  metodoPago: MetodoPagoVenta;

  @ApiProperty()
  @IsNumber()
  @Min(0.01)
  monto: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiProperty({
    required: false,
    description: 'Entidad financiera (TARJETA/TRANSFERENCIA)',
  })
  @IsOptional()
  @IsString()
  banco?: string;

  @ApiProperty({
    enum: FuenteIngreso,
    required: false,
    description: 'Adónde entra el dinero. Default: EFECTIVO→TESORERIA, digital→BANCO.',
  })
  @IsOptional()
  @IsEnum(FuenteIngreso)
  fuente?: FuenteIngreso;

  @ApiProperty({
    required: false,
    description: 'FK EmpresaBanco. Requerido si fuente=BANCO.',
  })
  @ValidateIf((o) => o.fuente === FuenteIngreso.BANCO)
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando fuente=BANCO' })
  bancoId?: string;
}
