import { PrismaClient, Rol } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import { stockDisponible } from './stock.util';

/**
 * Interfaz mínima de VentaService que necesita la tool (evita acoplarse al
 * tipo completo; el módulo inyecta el VentaService real).
 */
export interface VentaServiceLike {
  crearVentaYapeDiferida(
    empresaId: string,
    dto: any,
    cajeroId: string,
  ): Promise<any>;
  cobroYape(empresaId: string, ventaId: string, monto?: number): Promise<any>;
}

/**
 * Tool `crearVenta` (Fase 2) — la crítica: registra la venta del cliente y
 * genera el cobro Yape (charge con céntimos únicos), reusando el flujo
 * determinístico existente:
 *   1) VentaService.crearVentaYapeDiferida → crea la venta, RESERVA stock,
 *      no cobra ni emite comprobante hasta el pago.
 *   2) VentaService.cobroYape → genera el charge Yape y devuelve payAmount.
 * El cliente paga el monto exacto → la auto-validación (webhook) confirma.
 *
 * GUARDS: precio del sistema (NUNCA del LLM — ni está en el schema), stock
 * validado/reservado, pertenencia al tenant, vendedor = staff (no cliente).
 * Errores como DATOS para que el LLM reaccione.
 *
 * OJO: requiere VentaService (NestJS) → se prueba dentro del IaModule, no
 * standalone.
 */
export function crearCrearVentaTool(
  prisma: PrismaClient,
  ventaService: VentaServiceLike,
): DefinicionTool {
  return {
    nombre: 'crearVenta',
    descripcion:
      'Registra la compra del cliente y genera el cobro por Yape. Llámala ' +
      'SOLO cuando el cliente CONFIRMÓ explícitamente su pedido (producto, ' +
      'cantidad y, si es envío, la dirección). Devuelve el monto EXACTO a ' +
      'yapear. No inventes precios: se toman del sistema.',
    parametros: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Productos a comprar.',
          items: {
            type: 'object',
            properties: {
              productoId: { type: 'string' },
              cantidad: { type: 'number' },
              varianteId: { type: 'string' },
            },
            required: ['productoId', 'cantidad'],
          },
        },
        clienteId: {
          type: 'string',
          description: 'clienteEmpresaId devuelto por resolverCliente.',
        },
        nombreCliente: { type: 'string' },
        documentoCliente: { type: 'string', description: 'DNI (8) o CE (9).' },
        entrega: {
          type: 'object',
          properties: {
            conEnvio: { type: 'boolean' },
            direccion: { type: 'string' },
          },
        },
      },
      required: ['items', 'nombreCliente'],
    },

    async ejecutar(args, ctx: ContextoTool): Promise<ResultadoTool> {
      if (!ctx.sedeId) return { ok: false, motivo: 'SIN_SEDE' };

      // 1) Vendedor: staff activo más antiguo (NUNCA un CLIENTE).
      const staff = await prisma.empresaUsuarioRol.findFirst({
        where: {
          empresaId: ctx.empresaId,
          isActive: true,
          deletedAt: null,
          rol: { not: Rol.CLIENTE },
        },
        orderBy: { creadoEn: 'asc' },
        select: { usuarioId: true },
      });
      if (!staff) return { ok: false, motivo: 'SIN_VENDEDOR' };

      // 2) Detalles con PRECIO DEL SISTEMA y stock validado.
      const items = Array.isArray(args.items) ? (args.items as any[]) : [];
      if (items.length === 0) return { ok: false, motivo: 'SIN_ITEMS' };
      const detalles: any[] = [];
      for (const it of items) {
        const productoId = String(it?.productoId ?? '');
        const cantidad = Number(it?.cantidad ?? 0);
        if (!productoId || !(cantidad > 0)) {
          return { ok: false, motivo: 'ITEM_INVALIDO' };
        }
        const prod = await prisma.producto.findFirst({
          where: { id: productoId, empresaId: ctx.empresaId, deletedAt: null },
          include: {
            stocksPorSede: {
              where: { sedeId: ctx.sedeId, precio: { not: null } },
            },
          },
        });
        if (!prod) {
          return { ok: false, motivo: 'PRODUCTO_NO_ENCONTRADO', productoId };
        }
        const stock = prod.stocksPorSede[0];
        if (!stock) {
          return { ok: false, motivo: 'SIN_STOCK_EN_SEDE', productoId };
        }
        const disp = Math.max(0, stockDisponible(stock));
        if (cantidad > disp) {
          return {
            ok: false,
            motivo: 'STOCK_INSUFICIENTE',
            productoId,
            disponible: disp,
          };
        }
        detalles.push({
          productoId,
          varianteId: it?.varianteId ?? undefined,
          descripcion: prod.nombre,
          cantidad,
          precioUnitario: Number(stock.precio), // ← DEL SISTEMA, no del LLM
        });
      }

      // 3) Crear la venta (Yape diferida: reserva stock, sin cobrar aún).
      const doc = String(args.documentoCliente ?? '').replace(/\D/g, '');
      const entrega = (args.entrega ?? {}) as {
        conEnvio?: boolean;
        direccion?: string;
      };
      const dto = {
        canalVenta: 'ONLINE', // el enum no tiene WhatsApp; se marca en observaciones
        sedeId: ctx.sedeId,
        vendedorId: staff.usuarioId,
        clienteId: args.clienteId ? String(args.clienteId) : undefined,
        nombreCliente: String(args.nombreCliente ?? 'CLIENTE'),
        documentoCliente: doc || undefined,
        tipoDocumentoCliente:
          doc.length === 9 ? '4' : doc.length === 8 ? '1' : undefined,
        telefonoCliente: ctx.celular ?? undefined,
        conEnvio: !!entrega.conEnvio,
        direccionCliente: entrega.direccion ?? undefined,
        tipoComprobante: 'BOLETA',
        condicionPago: 'CONTADO',
        detalles,
        observaciones: 'Venta por agente IA (WhatsApp)',
      };

      let venta: any;
      try {
        venta = await ventaService.crearVentaYapeDiferida(
          ctx.empresaId,
          dto,
          staff.usuarioId,
        );
      } catch (e) {
        return { ok: false, motivo: 'ERROR_VENTA', detalle: (e as Error).message };
      }
      const ventaId = venta?.id ?? venta?.venta?.id;
      if (!ventaId) return { ok: false, motivo: 'VENTA_SIN_ID' };

      // 4) Generar el cobro Yape (payAmount con céntimos únicos).
      const cobro = await ventaService
        .cobroYape(ctx.empresaId, ventaId)
        .catch(() => null);

      return {
        ok: true,
        ventaId,
        total: Number(venta?.total ?? venta?.venta?.total ?? 0),
        yapeHabilitado: cobro?.habilitado ?? false,
        payAmount: cobro?.payAmount ?? null,
      };
    },
  };
}
