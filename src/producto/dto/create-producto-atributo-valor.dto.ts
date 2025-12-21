import { IsString, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para un solo valor de atributo
 */
export class AtributoValorDto {
  @IsString()
  @IsNotEmpty()
  atributoId: string; // ID del ProductoAtributo (plantilla)

  @IsString()
  @IsNotEmpty()
  valor: string; // Valor específico (siempre como string)
}

/**
 * DTO para asignar múltiples atributos a un producto o variante
 */
export class SetProductoAtributosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AtributoValorDto)
  atributos: AtributoValorDto[];
}
