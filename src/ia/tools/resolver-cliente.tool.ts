import { PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';

/**
 * Tool `resolverCliente` — identifica al cliente por su documento: DNI
 * (8 dígitos) o CE de extranjería (9). El documento vive en `Persona.dni`
 * (el CE se distingue por longitud, sin columna aparte).
 *
 * SPIKE (versión LECTURA): resuelve un cliente YA registrado. En el módulo
 * NestJS real, si no existe se llamará `ClientesService.getOrCreateByDni`
 * (crea la Persona/cuenta consultando RENIEC para DNI / Migraciones para CE)
 * — ver el TODO marcado abajo. Por eso el spike recibe PrismaClient y el
 * módulo inyectará además ClientesService.
 */
export function crearResolverClienteTool(prisma: PrismaClient): DefinicionTool {
  return {
    nombre: 'resolverCliente',
    descripcion:
      'Identifica al cliente por su DNI (8 dígitos) o CE de extranjería (9) ' +
      'para poder registrar su compra. Devuelve su nombre. Pídelo antes de ' +
      'crear una venta; no inventes el nombre.',
    parametros: {
      type: 'object',
      properties: {
        documento: {
          type: 'string',
          description: 'DNI (8 dígitos) o Carné de Extranjería (9 dígitos).',
        },
      },
      required: ['documento'],
    },

    async ejecutar(args, ctx: ContextoTool): Promise<ResultadoTool> {
      const doc = String(args.documento ?? '').replace(/\D/g, '');
      if (doc.length !== 8 && doc.length !== 9) {
        return { ok: false, motivo: 'DOCUMENTO_INVALIDO' };
      }

      const persona = await prisma.persona.findUnique({
        where: { dni: doc },
        select: {
          id: true,
          nombres: true,
          apellidos: true,
          empresasAsociadas: {
            where: { empresaId: ctx.empresaId, deletedAt: null },
            select: { id: true },
          },
        },
      });

      // TODO(módulo NestJS): si !persona → ClientesService.getOrCreateByDni(
      //   ctx.empresaId, doc) crea la Persona+cuenta (RENIEC 8 / Migraciones 9)
      //   y la asocia como cliente. El spike solo resuelve existentes.
      if (!persona) {
        return { ok: false, motivo: 'NO_REGISTRADO', documento: doc };
      }

      const clienteEmpresaId = persona.empresasAsociadas[0]?.id ?? null;
      return {
        ok: true,
        clienteId: clienteEmpresaId,
        personaId: persona.id,
        nombreCompleto: `${persona.nombres} ${persona.apellidos ?? ''}`.trim(),
        yaEsClienteDeEstaEmpresa: !!clienteEmpresaId,
        tipoDoc: doc.length === 9 ? 'CE' : 'DNI',
      };
    },
  };
}
