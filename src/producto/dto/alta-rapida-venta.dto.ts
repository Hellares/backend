import { IsNotEmpty, IsString, IsNumber, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Alta de un producto DESDE EL MOSTRADOR, en Venta Rápida.
 *
 * El caso: el cliente está migrando al sistema y tiene mercadería en el
 * estante que todavía no está cargada. Viene un técnico, pide 2 de algo que no
 * existe en el catálogo, y la cola no puede esperar a que alguien llene la
 * ficha completa del producto.
 *
 * Por eso pide SOLO tres datos —los únicos que no se pueden adivinar— y deja
 * todo lo demás para después:
 *
 *   - `nombre`   lo que el vendedor ya escribió en el buscador
 *   - `precio`   a cuánto se lo vende, IGV incluido
 *   - `cantidad` cuántas entran al stock (normalmente, las que se están vendiendo)
 *
 * Categoría, marca, unidad y COSTO quedan vacíos a propósito. La ficha se
 * completa después desde Inventario; el costo, además, no debería pasar por
 * el mostrador (ver el permiso `producto.alta-rapida-venta`).
 */
export class AltaRapidaVentaDto {
  @ApiProperty({ description: 'Empresa dueña del producto' })
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @ApiProperty({ description: 'Sede donde entra el stock y rige el precio' })
  @IsString()
  @IsNotEmpty()
  sedeId: string;

  @ApiProperty({ description: 'Nombre del producto', example: 'MOUSE LOGITECH M170' })
  @IsString()
  @IsNotEmpty({ message: 'El producto necesita un nombre' })
  @MaxLength(200)
  nombre: string;

  /**
   * 🔴 Es el precio FINAL al cliente: se guarda con `precioIncluyeIgv: true`.
   * Guardarlo como neto haría que la próxima venta le sume el IGV encima.
   */
  @ApiProperty({ description: 'Precio de venta al público, IGV incluido', example: 45.9 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.01, { message: 'El precio de venta tiene que ser mayor a 0' })
  precio: number;

  @ApiProperty({ description: 'Stock inicial que entra en la sede', example: 2 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  cantidad: number;
}
