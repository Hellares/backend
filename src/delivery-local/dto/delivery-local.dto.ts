import {
  IsBoolean,
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

  /**
   * Publicar en SUBASTA: los repartidores proponen precio y la empresa
   * elige. Mientras esté así, el pedido NO se puede tomar directo.
   */
  @IsOptional()
  @IsBoolean()
  modoOferta?: boolean;

  /** Ancla opcional para la subasta; puede ir vacío. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costoSugerido?: number;

  /** Tarifa que cobra el repartidor al entregar. Default: Sede.tarifaDeliveryLocal. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costoDelivery?: number;

  /** Coordenadas EXACTAS del destino (pin en el mapa): NAVEGAR del
   *  repartidor va al punto y el cliente ve el 📍 en su tracking. */
  @IsOptional()
  @IsNumber()
  destinoLat?: number;

  @IsOptional()
  @IsNumber()
  destinoLon?: number;

  /** Delivery INTERNO: lo lleva un empleado — NO se publica al pool ni se
   *  notifica repartidores; el staff avanza los estados (sin PIN). */
  @IsOptional()
  @IsBoolean()
  esInterno?: boolean;

  /** Nombre del empleado que lo lleva (informativo). */
  @IsOptional()
  @IsString()
  encargadoInterno?: string;
}

/**
 * Editar la dirección de entrega (staff): se eligió una equivocada o el
 * cliente pidió otro punto. Si no llega pin nuevo, el anterior se descarta
 * (apuntaba a la dirección vieja). No permitido en ENTREGADO/CANCELADO.
 */
export class ActualizarDireccionDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  direccion: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  @IsOptional()
  @IsNumber()
  destinoLat?: number;

  @IsOptional()
  @IsNumber()
  destinoLon?: number;
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

/** Compartir la ubicación de entrega por WhatsApp (desde la instancia de
 *  la empresa) a cualquier celular — sin salir del app. */
export class CompartirUbicacionDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  celular: string;
}

export class CancelarDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsOptional()
  @IsString()
  motivo?: string;
}

/**
 * Publicar en SUBASTA en vez de con tarifa fija. La empresa no siempre sabe
 * cuánto sale llegar a una zona; el repartidor sí.
 */
export class ModoOfertaDeliveryDto {
  @IsOptional()
  @IsBoolean()
  modoOferta?: boolean;

  /** Ancla opcional. Puede ir vacío: la empresa puede no tener idea. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costoSugerido?: number;
}

/** El repartidor propone su precio para un pedido en subasta. */
export class OfertarDeliveryDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsNumber()
  @Min(0.01)
  monto: number;

  /** "esa zona son 20 min de ida" — le da contexto al staff que decide. */
  @IsOptional()
  @IsString()
  comentario?: string;
}

/**
 * Enlace acortado de Google Maps que el cliente compartió por WhatsApp
 * (`maps.app.goo.gl/...`), para que el server siga la redirección y saque
 * las coordenadas.
 */
export class ResolverEnlaceUbicacionDto {
  @IsString()
  @IsNotEmpty()
  url: string;
}
