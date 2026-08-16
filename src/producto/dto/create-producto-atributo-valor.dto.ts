import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para un solo valor de atributo
 */
export class AtributoValorDto {
  @IsString()
  @IsNotEmpty()
  atributoId: string; // ID del ProductoAtributo (plantilla)

  /**
   * Valor específico (siempre como string).
   *
   * 🔑 Admite CADENA VACÍA a propósito: significa "el campo está asignado a
   * este producto/variante pero todavía sin llenar" —el caso típico es agregar
   * CÓDIGO DE BARRAS para escanearlo después—. Quien decide si eso se acepta
   * es `validateAtributos`, que a esa altura ya sabe si el atributo está
   * marcado como `requerido`; acá no hay forma de saberlo.
   */
  @IsString()
  valor: string;
}

/**
 * DTO para asignar múltiples atributos a un producto o variante
 */
export class SetProductoAtributosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AtributoValorDto)
  atributos: AtributoValorDto[];

  /**
   * Secciones de la ficha técnica que se acaban de aplicar.
   *
   * Se SUMAN a las que el producto ya tenía (no reemplazan): aplicar la
   * plantilla PANTALLA no borra la sección PROCESADOR que ya estaba.
   *
   * Sin esto, cargar atributos desde el detalle guardaba los valores pero no
   * de qué plantilla venían, y al reabrir el producto en edición no había
   * forma de reagrupar la ficha ni de saber qué campos dibujar.
   *
   * Solo aplica a productos: una variante no guarda secciones propias.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  plantillasAtributosIds?: string[];
}
