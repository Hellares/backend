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
  @IsNumber({ maxDecimalPlaces: 2 })
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
    description:
      'FK EmpresaBanco. Requerido si fuente=BANCO (explícito o por default: ' +
      'todo método != EFECTIVO sin fuente cae a BANCO).',
  })
  // También se exige cuando el método NO es EFECTIVO y no se mandó fuente, porque
  // el ruteo de ingreso defaultea a BANCO (que requiere bancoId) — 400 temprano.
  @ValidateIf(
    (o) =>
      o.fuente === FuenteIngreso.BANCO ||
      (!o.fuente && o.metodoPago !== MetodoPagoVenta.EFECTIVO),
  )
  @IsString()
  @IsNotEmpty({ message: 'bancoId es obligatorio cuando el abono entra a una cuenta bancaria' })
  bancoId?: string;
}
