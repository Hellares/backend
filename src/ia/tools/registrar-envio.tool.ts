import { EstadoVenta, PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import { buscarEnvioPrevio } from './resolver-cliente.tool';

/** Interfaz mínima de VentaService que necesita esta tool. */
export interface EnvioServiceLike {
  upsertEnvio(
    id: string,
    empresaId: string,
    dto: {
      destinatarioNombre: string;
      destinatarioDni?: string;
      destinatarioCelular?: string;
      agenciaNombre?: string;
      destinoDepartamento?: string;
      destinoProvincia?: string;
      agenciaDireccion?: string;
    },
  ): Promise<any>;
}

/**
 * Tool `registrarEnvio` — registra la dirección de ENVÍO de la última compra
 * del cliente, DESPUÉS del pago (mismo orden que el bot de sorteos: primero
 * paga, luego la dirección). La venta se ubica por el celular del remitente
 * (determinístico — el LLM no maneja ids de venta). Mapeo idéntico a sorteos:
 * ciudad→destinoProvincia, departamento→destinoDepartamento,
 * sucursal→agenciaDireccion; agencia = la de la empresa.
 */
export function crearRegistrarEnvioTool(
  prisma: PrismaClient,
  ventaService: EnvioServiceLike,
): DefinicionTool {
  return {
    nombre: 'registrarEnvio',
    descripcion:
      'Registra la dirección de ENVÍO por agencia de la ÚLTIMA compra del ' +
      'cliente. Llámala SOLO después de que el pago fue confirmado y el ' +
      'cliente pidió envío, con la ciudad y departamento que te dio (o con ' +
      'usarDireccionPrevia=true si aceptó su dirección registrada). Si otra ' +
      'persona recogerá, incluye su nombre y DNI.',
    parametros: {
      type: 'object',
      properties: {
        usarDireccionPrevia: {
          type: 'boolean',
          description:
            'true si el cliente aceptó usar su dirección registrada (envioPrevio).',
        },
        ciudad: { type: 'string', description: 'Ciudad/provincia de destino.' },
        departamento: { type: 'string', description: 'Departamento (región).' },
        direccionAgencia: {
          type: 'string',
          description:
            'Dirección o sucursal de la agencia donde recogerá. Omite si no la sabe.',
        },
        destinatarioNombre: {
          type: 'string',
          description: 'SOLO si recoge OTRA persona (no el comprador): su nombre.',
        },
        destinatarioDni: {
          type: 'string',
          description:
            'SOLO si recoge OTRA persona: su DNI (la agencia lo pide al entregar).',
        },
      },
    },

    async ejecutar(args, ctx: ContextoTool): Promise<ResultadoTool> {
      if (!ctx.celular) return { ok: false, motivo: 'SIN_CELULAR' };

      // Última venta ONLINE del cliente (por su celular), no anulada, reciente.
      const hace48h = new Date(Date.now() - 48 * 3600 * 1000);
      const venta = await prisma.venta.findFirst({
        where: {
          empresaId: ctx.empresaId,
          canalVenta: 'ONLINE',
          telefonoCliente: ctx.celular,
          estado: { not: EstadoVenta.ANULADA },
          creadoEn: { gte: hace48h },
        },
        orderBy: { creadoEn: 'desc' },
        select: {
          id: true,
          codigo: true,
          nombreCliente: true,
          documentoCliente: true,
        },
      });
      if (!venta) return { ok: false, motivo: 'SIN_VENTA_RECIENTE' };

      const limpio = (v?: unknown) => {
        const t = String(v ?? '').trim();
        return t.length >= 3 && t.length <= 60 ? t.toUpperCase() : undefined;
      };
      let ciudad = limpio(args.ciudad);
      let departamento = limpio(args.departamento);
      let direccionAgencia = limpio(args.direccionAgencia);

      // Dirección previa: si la pidió explícitamente o no dio ciudad/dpto.
      if (args.usarDireccionPrevia === true || (!ciudad && !departamento)) {
        const previo = await buscarEnvioPrevio(
          prisma,
          ctx.empresaId,
          venta.documentoCliente ?? '',
          ctx.celular,
        );
        if (previo) {
          ciudad = ciudad ?? previo.ciudad?.toUpperCase() ?? undefined;
          departamento =
            departamento ?? previo.departamento?.toUpperCase() ?? undefined;
          direccionAgencia =
            direccionAgencia ??
            previo.direccionAgencia?.toUpperCase() ??
            undefined;
        }
      }
      if (!ciudad && !departamento) {
        return { ok: false, motivo: 'FALTA_DESTINO' };
      }

      // DESTINATARIO: por defecto el comprador; si recoge OTRA persona, su
      // nombre oficial sale de la BD por su DNI (o el nombre dictado).
      let destNombre = venta.nombreCliente;
      let destDni = venta.documentoCliente ?? undefined;
      const otroDoc = String(args.destinatarioDni ?? '').replace(/\D/g, '');
      const otroNombre = String(args.destinatarioNombre ?? '').trim();
      if (otroDoc.length === 8 || otroDoc.length === 9) {
        const otra = await prisma.persona.findUnique({
          where: { dni: otroDoc },
          select: { nombres: true, apellidos: true },
        });
        destNombre = otra
          ? `${otra.nombres} ${otra.apellidos ?? ''}`.trim()
          : otroNombre || venta.nombreCliente;
        destDni = otroDoc;
      } else if (otroNombre) {
        destNombre = otroNombre.toUpperCase();
        destDni = undefined;
      }

      const wpp = await prisma.integracionWhatsapp.findUnique({
        where: { empresaId: ctx.empresaId },
        select: { agenciaEnvio: true },
      });
      const agencia = wpp?.agenciaEnvio?.trim() || 'SHALOM';

      try {
        await ventaService.upsertEnvio(venta.id, ctx.empresaId, {
          destinatarioNombre: destNombre,
          destinatarioDni: destDni,
          destinatarioCelular: ctx.celular,
          agenciaNombre: agencia,
          destinoProvincia: ciudad,
          destinoDepartamento: departamento,
          agenciaDireccion: direccionAgencia,
        });
      } catch (e) {
        return { ok: false, motivo: 'ERROR_ENVIO', detalle: (e as Error).message };
      }

      return {
        ok: true,
        ventaCodigo: venta.codigo,
        agencia,
        ciudad: ciudad ?? null,
        departamento: departamento ?? null,
        direccionAgencia: direccionAgencia ?? null,
        destinatario: destNombre,
      };
    },
  };
}
