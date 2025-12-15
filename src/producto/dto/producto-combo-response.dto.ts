/**
 * DTO de respuesta para componente de combo
 * Incluye información completa del componente y su producto/variante
 */
export class ProductoComboResponseDto {
  id: string;
  comboId: string;
  componenteProductoId?: string;
  componenteVarianteId?: string;
  cantidad: number;
  esPersonalizable: boolean;
  categoriaComponente?: string;
  orden: number;
  creadoEn: Date;
  actualizadoEn: Date;

  // Información del componente (producto o variante)
  componenteInfo?: {
    id: string;
    nombre: string;
    sku?: string;
    precio: number;
    stock: number;
    imagen?: string;
    esVariante: boolean;
    productoNombre?: string; // Nombre del producto (cuando es variante)
    varianteNombre?: string; // Nombre de la variante específica
  };
}

/**
 * DTO de respuesta completa para un producto combo
 * Incluye todos los componentes y cálculos de stock/precio
 */
export class ComboCompletoResponseDto {
  id: string;
  nombre: string;
  descripcion?: string;
  esCombo: boolean;
  tipoPrecioCombo: string;
  precio: number;
  precioCalculado: number; // Suma real de componentes
  descuentoPorcentaje?: number; // Porcentaje de descuento (si aplica)
  descuentoAplicado?: number;
  stockDisponible: number; // Stock máximo de combos que se pueden armar
  componentes: ProductoComboResponseDto[];

  // Validaciones
  tieneStockSuficiente: boolean;
  componentesSinStock?: string[]; // Nombres de componentes sin stock
  imagen?: string; // URL de la imagen principal
}
