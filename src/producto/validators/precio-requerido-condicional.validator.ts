import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { TipoPrecioCombo } from '@prisma/client';

/**
 * Validador que requiere el campo precio solo cuando:
 * - NO es un combo (esCombo = false o undefined), O
 * - Es un combo pero con tipoPrecioCombo = FIJO
 *
 * Si es combo con precio CALCULADO o CALCULADO_CON_DESCUENTO,
 * el precio se calculará automáticamente de los componentes.
 */
export function IsPrecioRequeridoCondicional(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isPrecioRequeridoCondicional',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as any;

          // Si NO es combo, el precio es requerido
          if (!obj.esCombo) {
            return value !== undefined && value !== null && value !== '';
          }

          // Si es combo con precio FIJO, el precio es requerido
          if (obj.esCombo && obj.tipoPrecioCombo === TipoPrecioCombo.FIJO) {
            return value !== undefined && value !== null && value !== '';
          }

          // Si es combo con precio CALCULADO o CALCULADO_CON_DESCUENTO,
          // el precio NO es requerido (se calculará después)
          if (
            obj.esCombo &&
            (obj.tipoPrecioCombo === TipoPrecioCombo.CALCULADO ||
              obj.tipoPrecioCombo === TipoPrecioCombo.CALCULADO_CON_DESCUENTO)
          ) {
            return true; // Válido sin importar si tiene valor o no
          }

          // Por defecto, requiere el precio
          return value !== undefined && value !== null && value !== '';
        },
        defaultMessage(args: ValidationArguments) {
          const obj = args.object as any;

          if (obj.esCombo && obj.tipoPrecioCombo === TipoPrecioCombo.FIJO) {
            return 'El precio es requerido para combos con precio FIJO';
          }

          return 'El precio de venta es requerido';
        },
      },
    });
  };
}
