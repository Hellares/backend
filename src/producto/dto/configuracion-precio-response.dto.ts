import { TipoPrecioNivel } from './create-configuracion-precio-nivel.dto';

export class ConfiguracionPrecioNivelResponseDto {
  id: string;
  nombre: string;
  cantidadMinima: number;
  cantidadMaxima: number | null;
  tipoPrecio: TipoPrecioNivel;
  porcentajeDesc: number | null;
  descripcion: string | null;
  orden: number;
}

export class ConfiguracionPrecioResponseDto {
  id: string;
  empresaId: string;
  nombre: string;
  descripcion: string | null;
  isActive: boolean;
  niveles: ConfiguracionPrecioNivelResponseDto[];
  creadoEn: Date;
  actualizadoEn: Date;

  // Información adicional útil
  cantidadProductosUsando?: number;
}
