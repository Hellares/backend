import { IsString, IsNotEmpty, IsNumber, IsOptional, IsObject, IsBoolean, Min, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class VarianteAtributoDto {
  @IsString()
  @IsNotEmpty()
  atributoId: string; // ID del ProductoAtributo

  /**
   * Valor del atributo.
   *
   * 🔑 Admite CADENA VACÍA: es "el campo está asignado pero todavía sin
   * llenar" —agregar CÓDIGO DE BARRAS para escanearlo después—. Si el atributo
   * está marcado como `requerido`, lo rechaza el servicio, que es el único que
   * tiene ese dato a mano.
   */
  @IsString()
  valor: string;
}

export class CreateProductoVarianteDto {
  @IsString()
  @IsNotEmpty()
  nombre: string; // "Negro - USB", "Blanco - Bluetooth"

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsOptional()
  unidadMedidaId?: string | null; // ID de la unidad de medida (EmpresaUnidadMedida)

  // ─── Unidad de PRESENTACIÓN de la variante ────────────────────
  // Cómo se le habla al cliente cuando la unidad de venta es demasiado chica:
  // el GRANEL que sale de abrir un saco se guarda en gramos y se cobra en
  // kilos. Si está seteada gana sobre la presentación del producto padre.
  // Sin ella la variante hereda la del producto, que es lo de siempre.
  @IsString()
  @IsOptional()
  unidadPresentacionId?: string | null;

  @IsNumber()
  @Type(() => Number)
  @Min(1.0001, {
    message:
      'factorPresentacion debe ser mayor a 1: una presentación existe para AGRUPAR unidades de venta (kg = 1000 g).',
  })
  @IsOptional()
  factorPresentacion?: number | null;

  // ─── Apertura de bulto ────────────────────────────────────────
  // En qué variante se convierte ésta al abrirla (SACO → GRANEL) y cuánto
  // rinde, en unidad de VENTA del destino (15 000 si el granel va en gramos).
  @IsString()
  @IsOptional()
  varianteAperturaId?: string | null;

  @IsNumber()
  @Type(() => Number)
  @Min(0.0001)
  @IsOptional()
  rendimientoApertura?: number | null;

  @IsString()
  @IsOptional()
  codigoBarras?: string;

  // ✅ Atributos estructurados (recomendado)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VarianteAtributoDto)
  @IsOptional()
  atributosEstructurados?: VarianteAtributoDto[];

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  peso?: number;

  @IsObject()
  @IsOptional()
  dimensiones?: Record<string, number>; // {"largo": 30, "ancho": 20, "alto": 5}

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  orden?: number;

  @IsString({ each: true })
  @IsOptional()
  imagenesIds?: string[]; // IDs de archivos para la variante
}
