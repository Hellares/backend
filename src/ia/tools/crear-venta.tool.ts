import { PrismaClient, Rol, TipoAfectacionIgv } from '@prisma/client';
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
              varianteId: {
                type: 'string',
                description:
                  'Inclúyelo SOLO si el producto elegido vino con "varianteId" ' +
                  'en el resultado de buscarProducto (ej. "EDREDON Cristal").',
              },
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
        const varianteId = it?.varianteId ? String(it.varianteId) : null;
        const cantidad = Number(it?.cantidad ?? 0);
        if (!productoId || !(cantidad > 0)) {
          return { ok: false, motivo: 'ITEM_INVALIDO' };
        }
        // Producto (guard de pertenencia al tenant) + nombre.
        const prod = await prisma.producto.findFirst({
          where: { id: productoId, empresaId: ctx.empresaId, deletedAt: null },
          select: { id: true, nombre: true, tipoAfectacionIgv: true },
        });
        if (!prod) {
          return { ok: false, motivo: 'PRODUCTO_NO_ENCONTRADO', productoId };
        }

        // Stock/precio: el de la VARIANTE si viene (ramificado por varianteId,
        // NUNCA AND productoId+varianteId), o el del producto si es simple.
        let nombre = prod.nombre;
        let stock;
        if (varianteId) {
          const variante = await prisma.productoVariante.findFirst({
            where: {
              id: varianteId,
              productoId,
              empresaId: ctx.empresaId,
              isActive: true,
              deletedAt: null,
            },
            select: { id: true, nombre: true },
          });
          if (!variante) {
            return { ok: false, motivo: 'VARIANTE_NO_ENCONTRADA', productoId };
          }
          nombre = `${prod.nombre} ${variante.nombre}`.trim();
          stock = await prisma.productoStock.findFirst({
            where: { varianteId, sedeId: ctx.sedeId, precio: { not: null } },
          });
        } else {
          stock = await prisma.productoStock.findFirst({
            where: {
              productoId,
              varianteId: null,
              sedeId: ctx.sedeId,
              precio: { not: null },
            },
          });
        }
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
        // El precio del catálogo (ProductoStock.precio) es el precio final que
        // paga el cliente → YA INCLUYE IGV. Se marca precioIncluyeIgv para que
        // VentaService extraiga base+IGV en vez de sumarlo encima (bug: cobraba
        // IGV doble). El % y la afectación salen del tipo del producto.
        const gravado = prod.tipoAfectacionIgv === TipoAfectacionIgv.GRAVADO;
        const tipoAfectacion =
          prod.tipoAfectacionIgv === TipoAfectacionIgv.GRAVADO
            ? '10'
            : prod.tipoAfectacionIgv === TipoAfectacionIgv.EXONERADO
              ? '20'
              : '30';
        detalles.push({
          productoId,
          varianteId: varianteId ?? undefined,
          descripcion: nombre,
          cantidad,
          precioUnitario: Number(stock.precio), // ← DEL SISTEMA, no del LLM
          precioIncluyeIgv: true,
          porcentajeIGV: gravado ? 18 : 0,
          tipoAfectacion,
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

      // 5) Número al que el cliente yapea (para decírselo): el de pago del
      //    WhatsApp, si no el de IntegracionYape.
      const wpp = await prisma.integracionWhatsapp.findUnique({
        where: { empresaId: ctx.empresaId },
        select: { numeroPago: true },
      });
      let numeroPago = wpp?.numeroPago ?? null;
      if (!numeroPago) {
        const iy = await prisma.integracionYape.findUnique({
          where: { empresaId: ctx.empresaId },
          select: { celular: true },
        });
        numeroPago = iy?.celular ?? null;
      }

      return {
        ok: true,
        ventaId,
        total: Number(venta?.total ?? venta?.venta?.total ?? 0),
        yapeHabilitado: cobro?.habilitado ?? false,
        payAmount: cobro?.payAmount ?? null,
        numeroPago,
      };
    },
  };
}
