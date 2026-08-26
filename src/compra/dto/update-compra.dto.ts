import { PartialType } from '@nestjs/swagger';
import { CreateCompraDto } from './create-compra.dto';

/**
 * Edición de una compra en BORRADOR.
 *
 * Es `CreateCompraDto` con todo opcional a propósito: `CompraService.update`
 * está escrito como un MERGE —cada campo cae al valor guardado si no viene, y
 * los detalles solo se reemplazan `if (dto.detalles)`— así que el caso real de
 * "me olvidé el flete" manda únicamente `{ gastos: [...] }` y no tiene por qué
 * reenviar la compra entera. Con `CreateCompraDto` en el controller ese body
 * rebotaba con 400 por `sedeId`, `proveedorId` y `detalles` faltantes.
 *
 * 🔴 Va PartialType y no una copia a mano de los campos: el servicio recibe
 * literalmente `Partial<CreateCompraDto>`, y una copia manual se desincroniza
 * en silencio la próxima vez que se le agregue un campo al create.
 */
export class UpdateCompraDto extends PartialType(CreateCompraDto) {}
