export class ProductoVarianteResponseDto {
  id: string;
  productoId: string;
  empresaId: string;

  nombre: string;
  sku: string;
  codigoBarras?: string;
  codigoEmpresa: string;

  atributos: Record<string, any>;

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
