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
  precioEnCombo?: number; // Precio override dentro del combo (null = usa precio regular)
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
    precio: number;          // Precio regular del producto (desde ProductoStock)
    precioEnCombo?: number;  // Precio dentro del combo (override). Null = se usa precio regular.
    stock: number;           // Stock disponible real (stockActual - reservados - dañados - garantía)
    imagen?: string;
    esVariante: boolean;
    productoNombre?: string;
    varianteNombre?: string;
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
  precio: number;              // Precio final del combo (lo que paga el cliente)
  precioCalculado: number;     // Precio calculado desde componentes (con overrides aplicados)
  precioRegularTotal: number;  // Precio si se comprara cada componente por separado (sin overrides ni descuento)
  descuentoPorcentaje?: number;
  descuentoAplicado?: number;  // Ahorro total: precioRegularTotal - precio
  stockDisponible: number;

  componentes: ProductoComboResponseDto[];
  tieneStockSuficiente: boolean;
  componentesSinStock?: string[];
  imagen?: string;
}
