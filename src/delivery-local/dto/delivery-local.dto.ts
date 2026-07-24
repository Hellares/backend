import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Solicitar delivery local para una venta YA PAGADA al 100%. */
export class SolicitarDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  ventaId: string;

  /** Default: nombre del cliente de la venta. */
  @IsOptional()
  @IsString()
  destinatarioNombre?: string;

  /** Default: teléfono del cliente de la venta. */
  @IsOptional()
  @IsString()
  destinatarioCelular?: string;

  @IsString()
  @IsNotEmpty()
  direccion: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  /** Tarifa que cobra el repartidor al entregar. Default: Sede.tarifaDeliveryLocal. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costoDelivery?: number;
}

/** Acciones del repartidor (tomar / en-camino / entregado). */
export class AccionDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;
}

/** Entrega con prueba: PIN que el cliente le dicta al repartidor. */
export class EntregarDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsOptional()
  @IsString()
  pin?: string;
}

/** Posición GPS del repartidor (mientras va EN_CAMINO). */
export class ReportarPosicionDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsNumber()
  @Min(-90)
  lat: number;

  @IsNumber()
  @Min(-180)
  lon: number;
}

export class CancelarDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsOptional()
  @IsString()
  motivo?: string;
}
