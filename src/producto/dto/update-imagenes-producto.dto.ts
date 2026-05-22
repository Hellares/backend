import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

/**
 * DTO para actualizar SOLO las imágenes de un producto.
 *
 * Se usa desde el endpoint `PATCH /productos/:id/imagenes`, pensado
 * para que roles sin `MANAGE_PRODUCTS` (vendedor / cajero) puedan
 * subir o reemplazar imágenes desde Venta Rápida sin habilitarles la
 * edición de los demás campos del producto.
 */
export class UpdateImagenesProductoDto {
  @ApiProperty({
    description:
      'IDs de archivos (Archivo.id) a asociar como imágenes del producto. ' +
      'El orden importa: el primer ID se considera imagen principal. ' +
      'Lista vacía elimina todas las imágenes actuales.',
    type: [String],
    example: ['archivo1', 'archivo2', 'archivo3'],
  })
  @IsArray()
  @IsString({ each: true })
  imagenesIds: string[];
}
