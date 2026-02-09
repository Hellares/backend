import { IsArray, IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO para eliminar múltiples componentes de un combo en batch
 */
export class DeleteComponentesComboBatchDto {
  @IsArray()
  @IsNotEmpty({ each: true })
  @IsString({ each: true })
  componenteIds: string[];
}
