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

  // Unidad de PRESENTACIÓN propia. Si está, gana sobre la del producto: es el
  // granel que se guarda en gramos y se cobra en kilos.
  unidadPresentacionId?: string | null;
  /// Símbolo legible ("kg"): el diálogo de precios cobra en esta unidad.
  unidadPresentacionSimbolo?: string | null;
  factorPresentacion?: number | null;

  // Apertura de bulto: en qué variante se convierte al abrirla y cuánto rinde
  // (en unidad de venta del destino).
  varianteAperturaId?: string | null;
  rendimientoApertura?: number | null;

  // ✅ Atributos estructurados (nuevo formato)
  atributosValores: AtributoValorDto[];

  precio: number;
  precioCosto?: number;
  precioOferta?: number;

  // Niveles de precio por volumen ("Por Mayor 3+").
  // A diferencia de precio y precioCosto, que son POR SEDE, el nivel es
  // global a la variante: PrecioNivel no tiene sedeId.
  preciosNivel?: {
    id: string;
    nombre: string;
    cantidadMinima: number;
    cantidadMaxima: number | null;
    tipoPrecio: string;
    precio: number | null;
    porcentajeDesc: number | null;
  }[];

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
