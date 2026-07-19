import { PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';

/**
 * Interfaz mínima de ConsultasExternasService (Factiliza): resuelve el nombre
 * oficial por DNI (RENIEC) o CE (Migraciones). Ambos tiran error si no existe.
 */
export interface ConsultasLike {
  consultarDni(dni: string): Promise<{
    nombres?: string;
    apellidoPaterno?: string;
    apellidoMaterno?: string;
    nombreCompleto?: string;
  }>;
  consultarCee(cee: string): Promise<{
    nombres?: string;
    apellidoPaterno?: string;
    apellidoMaterno?: string;
    nombreCompleto?: string;
  }>;
}

/**
 * Tool `resolverCliente` — identifica al cliente por su documento: DNI
 * (8 dígitos) o CE de extranjería (9). El documento vive en `Persona.dni`
 * (el CE se distingue por longitud, sin columna aparte).
 *
 * Orden: 1) base local (cliente ya registrado) → 2) si no está, Factiliza
 * (RENIEC para DNI / Migraciones para CE) para traer el nombre oficial. Así el
 * agente puede confirmar el nombre y registrar la venta aunque sea cliente
 * nuevo. `consultas` es opcional (el spike corre sin el servicio externo).
 */
export function crearResolverClienteTool(
  prisma: PrismaClient,
  consultas?: ConsultasLike,
): DefinicionTool {
  return {
    nombre: 'resolverCliente',
    descripcion:
      'Identifica al cliente por su DNI (8 dígitos) o CE de extranjería (9). ' +
      'EN CUANTO el cliente te dé un DNI/CE, llama a esta herramienta ANTES de ' +
      'pedirle el nombre: primero busca en la base y, si no está, consulta ' +
      'RENIEC/Migraciones y devuelve el nombre oficial (registrado=false) para ' +
      'que lo confirmes. Solo pide el nombre a mano si devuelve NO_ENCONTRADO. ' +
      'No inventes el nombre.',
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
      const tipoDoc = doc.length === 9 ? 'CE' : 'DNI';

      // 1) Base local: ¿ya es una Persona registrada?
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

      if (persona) {
        const clienteEmpresaId = persona.empresasAsociadas[0]?.id ?? null;
        return {
          ok: true,
          registrado: true,
          clienteId: clienteEmpresaId,
          personaId: persona.id,
          nombreCompleto: `${persona.nombres} ${persona.apellidos ?? ''}`.trim(),
          yaEsClienteDeEstaEmpresa: !!clienteEmpresaId,
          tipoDoc,
        };
      }

      // 2) No está en la base → RENIEC/Migraciones (Factiliza) por el nombre.
      if (!consultas) {
        return { ok: false, motivo: 'NO_REGISTRADO', documento: doc };
      }
      try {
        const data =
          doc.length === 9
            ? await consultas.consultarCee(doc)
            : await consultas.consultarDni(doc);
        const nombre = `${data.nombres ?? ''} ${data.apellidoPaterno ?? ''} ${
          data.apellidoMaterno ?? ''
        }`
          .replace(/\s+/g, ' ')
          .trim();
        if (!nombre) {
          return { ok: false, motivo: 'NO_ENCONTRADO', documento: doc };
        }
        return {
          ok: true,
          registrado: false, // existe en RENIEC/Migraciones pero NO es cliente aún
          nombreCompleto: nombre,
          fuente: doc.length === 9 ? 'MIGRACIONES' : 'RENIEC',
          tipoDoc,
          documento: doc,
        };
      } catch {
        // Factiliza no lo encontró (o no respondió).
        return { ok: false, motivo: 'NO_ENCONTRADO', documento: doc };
      }
    },
  };
}
