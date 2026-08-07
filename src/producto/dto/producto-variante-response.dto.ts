export class AtributoValorDto {
  id: string;
  atributoId: string;
  valor: string;

  // Información del atributo (plantilla)
  atributo: {
    id: string;
    nombre: string;
    clave: string;
    tipo: string;
    unidad?: string;
  };
}

export class ProductoVarianteResponseDto {
  id: string;
  productoId: string;
  empresaId: string;

  nombre: string;
  sku: string;
  codigoBarras?: string;
  codigoEmpresa: string;

  // Unidad de VENTA propia de la variante. null = usa la del producto.
  unidadMedidaId?: string | null;

  // ✅ Atributos estructurados (nuevo formato)
  atributosValores: AtributoValorDto[];

  precio: number;
  precioCosto?: number;
  precioOferta?: number;

  // Stock total calculado desde ProductoStock (suma de todas las sedes)
  stock: number;

  // Stock y precios desglosados por sede (sistema multi-sede)
  stocksPorSede?: {
    sedeId: string;
    sedeNombre: string;
    sedeCodigo: string;
    cantidad: number;
    precio?: number;
    precioCosto?: number;
    precioOferta?: number;
    enOferta: boolean;
    precioConfigurado: boolean;
  }[];

  peso?: number;
  dimensiones?: Record<string, number>;

  isActive: boolean;
  orden: number;

  archivos?: {
    id: string;
    url: string;
    urlThumbnail?: string;
    orden?: number;
  }[];

  creadoEn: Date;
  actualizadoEn: Date;
}
