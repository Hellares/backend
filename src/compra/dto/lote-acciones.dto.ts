import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Sacar un lote del inventario: se venció, se rompió, se perdió.
 *
 * 🔴 Es la ÚNICA salida cuando un producto de CADUCIDAD vence: el guard de la
 * venta lo bloquea sin autorización posible, y sin esto el lote se queda
 * adelante en la fila FEFO frenando toda venta de ese producto para siempre.
 */
export class DarDeBajaLoteDto {
  @ApiPropertyOptional({
    description:
      'Cuántas unidades dar de baja. Omitida = TODO lo que queda en el lote, ' +
      'que es el caso normal cuando venció.',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cantidad?: number;

  @ApiProperty({
    description:
      'Por qué se da de baja. Obligatorio: sacar mercadería del inventario ' +
      'sin explicar por qué deja un agujero que después nadie puede auditar.',
    example: 'Vencido el 13-08, se descartó',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motivo: string;
}

/**
 * Corregir la fecha de vencimiento de un lote mal cargada.
 *
 * 🔑 La otra salida que el guard de CADUCIDAD le ofrece al cajero: si la fecha
 * se tipeó mal, no hay que tirar mercadería buena — hay que arreglar el dato.
 * Por eso es un permiso distinto de "autorizar la venta": corregir un error de
 * carga no es lo mismo que decidir vender algo vencido.
 */
export class CorregirVencimientoLoteDto {
  @ApiProperty({
    description:
      'La fecha correcta, la que está impresa en el envase. Null para dejar ' +
      'el lote SIN vencimiento (se cargó una fecha a un producto que no vence).',
    example: '2027-03-15',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string | null;

  @ApiProperty({
    description:
      'Por qué se corrige. Queda en el historial del lote: cambiar un ' +
      'vencimiento es exactamente lo que alguien haría para saltarse el ' +
      'bloqueo, así que tiene que dejar rastro.',
    example: 'Se cargó 13-08 por error, el envase dice 13-12',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motivo: string;
}
