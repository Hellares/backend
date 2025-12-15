import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsPrecioMayorQueCosto(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isPrecioMayorQueCosto',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          const obj = args.object as any;

          // Si no hay precio de costo, la validación pasa
          if (obj.precioCosto === undefined || obj.precioCosto === null) {
            return true;
          }

          // Si no hay precio, la validación falla (esto debería ser validado por @IsNumber)
          if (value === undefined || value === null) {
            return false;
          }

          // Validar que precio >= precioCosto
          return Number(value) >= Number(obj.precioCosto);
        },
        defaultMessage(args: ValidationArguments) {
          return 'El precio de venta debe ser mayor o igual al precio de costo';
        },
      },
    });
  };
}
