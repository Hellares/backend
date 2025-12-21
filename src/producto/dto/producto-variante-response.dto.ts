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

  // ✅ Atributos estructurados (nuevo formato)
  atributosValores: AtributoValorDto[];

  precio: number;
  precioCosto?: number;
  precioOferta?: number;

  stock: number;
  stockMinimo?: number;

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
