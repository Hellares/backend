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
 * Tool `crearVenta` (Fase 2) — la crítica: registra la venta del cliente
 * reusando el flujo determinístico existente:
 *   VentaService.crearVentaYapeDiferida → crea la venta, RESERVA stock,
 *   no cobra ni emite comprobante hasta el pago.
 * El cliente paga el precio REDONDO desde SU cuenta Yape → el webhook
 * payment.received lo auto-valida por NOMBRE + monto exacto (como en
 * sorteos). Sin charges con céntimos: confundían al cliente.
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
              productoId: {
                type: 'string',
                description:
                  'El campo "id" EXACTO del producto tal como lo devolvió ' +
                  'buscarProducto (un código largo). Úsalo tal cual, no el nombre.',
              },
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
        nombreCliente: { type: 'string' },
        documentoCliente: {
          type: 'string',
          description:
            'DNI (8) o CE (9) que dio el cliente. SIEMPRE inclúyelo si lo ' +
            'tienes: con él el sistema usa el nombre oficial y vincula al ' +
            'cliente registrado.',
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
      // Incluye stock a nivel producto (varianteId null) + variantes con su stock.
      const includeStock = {
        stocksPorSede: {
          where: {
            sedeId: ctx.sedeId,
            varianteId: null,
            precio: { not: null },
          },
        },
        variantes: {
          where: { isActive: true, deletedAt: null },
          select: {
            id: true,
            nombre: true,
            stocksPorSede: {
              where: { sedeId: ctx.sedeId, precio: { not: null } },
            },
          },
        },
      };

      for (const it of items) {
        let rawProdId = String(it?.productoId ?? '').trim();
        let varianteId = it?.varianteId ? String(it.varianteId).trim() : null;
        const cantidad = Number(it?.cantidad ?? 0);
        if (!rawProdId || !(cantidad > 0)) {
          return { ok: false, motivo: 'ITEM_INVALIDO' };
        }

        // PRIMERO: resolver contra el CATÁLOGO ya mostrado en la conversación
        // (buscarProducto/verDetalle lo llenaron). Así, aunque el LLM mande el
        // nombre ("LAPICERO") o un id parcial, lo mapeamos al id+variante REAL.
        const cat = ctx.catalogoReciente ?? [];
        const low = rawProdId.toLowerCase();
        let hit =
          cat.find((c) => c.id === rawProdId) ||
          cat.find((c) => c.nombre.toLowerCase() === low);
        if (!hit && low.length >= 3) {
          const parciales = cat.filter(
            (c) =>
              c.nombre.toLowerCase().includes(low) ||
              low.includes(c.nombre.toLowerCase()),
          );
          if (parciales.length === 1) hit = parciales[0];
        }
        if (!hit) {
          // Haiku a veces inventa códigos derivados del nombre ("LAP001" para
          // LAPICERO): comparar solo las LETRAS del código contra el catálogo.
          const letras = low.replace(/[^a-záéíóúñ]/g, '');
          if (letras.length >= 3) {
            const porLetras = cat.filter((c) =>
              c.nombre.toLowerCase().includes(letras),
            );
            if (porLetras.length === 1) hit = porLetras[0];
          }
        }
        if (hit) {
          rawProdId = hit.id;
          if (!varianteId && hit.varianteId) varianteId = hit.varianteId;
        }

        // Resolver el PRODUCTO: por id; si el LLM mandó el NOMBRE (Haiku no
        // siempre copia el id largo, ej. "LAPICERO"), se busca por nombre y se
        // toma el ÚNICO con stock en la sede. Ambiguo/ninguno → error con opciones.
        let prod: any = await prisma.producto.findFirst({
          where: { id: rawProdId, empresaId: ctx.empresaId, deletedAt: null },
          include: includeStock,
        });
        if (!prod) {
          const cands = await prisma.producto.findMany({
            where: {
              empresaId: ctx.empresaId,
              deletedAt: null,
              OR: [
                { nombre: { contains: rawProdId, mode: 'insensitive' } },
                { descripcion: { contains: rawProdId, mode: 'insensitive' } },
              ],
            },
            include: includeStock,
            take: 8,
          });
          const conStock = cands.filter(
            (c: any) =>
              c.stocksPorSede.length > 0 ||
              c.variantes.some((v: any) => v.stocksPorSede.length > 0),
          );
          if (conStock.length === 1) {
            prod = conStock[0];
          } else if (conStock.length === 0 && cat.length === 1) {
            // ÚLTIMO RECURSO determinístico: en la conversación solo se mostró
            // UN producto → un id irresoluble ("LAP001") solo puede ser ese.
            // (Si el cliente pidiera otro producto real, la búsqueda por nombre
            // de arriba ya lo habría encontrado y no llegaríamos aquí.)
            if (!varianteId && cat[0].varianteId) varianteId = cat[0].varianteId;
            prod = await prisma.producto.findFirst({
              where: { id: cat[0].id, empresaId: ctx.empresaId, deletedAt: null },
              include: includeStock,
            });
          }
          if (!prod) {
            return {
              ok: false,
              motivo:
                conStock.length === 0 ? 'PRODUCTO_NO_ENCONTRADO' : 'PRODUCTO_AMBIGUO',
              productoId: rawProdId,
              opciones: conStock
                .slice(0, 5)
                .map((c: any) => ({ id: c.id, nombre: c.nombre })),
            };
          }
        }
        const productoId = prod.id;

        // Elegir la UNIDAD comprable: variante indicada; o producto simple con
        // stock; o su única variante con stock (si hay varias → pedir cuál).
        let nombre = prod.nombre;
        let stock: any = null;
        if (varianteId) {
          const v = prod.variantes.find((x: any) => x.id === varianteId);
          if (!v) return { ok: false, motivo: 'VARIANTE_NO_ENCONTRADA', productoId };
          nombre = `${prod.nombre} ${v.nombre}`.trim();
          stock = v.stocksPorSede.find((s: any) => s.precio != null) ?? null;
        } else if (prod.stocksPorSede.length > 0) {
          stock = prod.stocksPorSede[0];
        } else {
          const varsConStock = prod.variantes.filter(
            (v: any) => v.stocksPorSede.length > 0,
          );
          if (varsConStock.length === 1) {
            varianteId = varsConStock[0].id;
            nombre = `${prod.nombre} ${varsConStock[0].nombre}`.trim();
            stock = varsConStock[0].stocksPorSede[0];
          } else if (varsConStock.length > 1) {
            return {
              ok: false,
              motivo: 'FALTA_VARIANTE',
              productoId,
              variantes: varsConStock.map((v: any) => ({ id: v.id, nombre: v.nombre })),
            };
          }
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
      // El ENVÍO se registra DESPUÉS de validado el pago (tool registrarEnvio,
      // como en sorteos: primero paga, luego la dirección).
      const doc = String(args.documentoCliente ?? '').replace(/\D/g, '');
      // CLIENTE: con documento, el nombre OFICIAL y el vínculo salen de la BD
      // (Persona por dni), NUNCA del LLM — recorta/reformatea ("James Johel" en
      // vez de "JAMES JOHEL TORRES LEDEZMA") e inventa ids. Si la persona no
      // está registrada, queda el nombre que confirmó la conversación
      // (resolverCliente/Factiliza) como snapshot.
      let nombreCliente = String(args.nombreCliente ?? 'CLIENTE');
      let clienteId: string | undefined;
      if (doc.length === 8 || doc.length === 9) {
        const persona = await prisma.persona.findUnique({
          where: { dni: doc },
          select: {
            nombres: true,
            apellidos: true,
            empresasAsociadas: {
              where: { empresaId: ctx.empresaId, deletedAt: null },
              select: { id: true },
            },
          },
        });
        if (persona) {
          nombreCliente =
            `${persona.nombres} ${persona.apellidos ?? ''}`.trim() ||
            nombreCliente;
          clienteId = persona.empresasAsociadas[0]?.id;
        }
      }
      const dto = {
        canalVenta: 'ONLINE', // el enum no tiene WhatsApp; se marca en observaciones
        sedeId: ctx.sedeId,
        vendedorId: staff.usuarioId,
        clienteId,
        nombreCliente,
        documentoCliente: doc || undefined,
        tipoDocumentoCliente:
          doc.length === 9 ? '4' : doc.length === 8 ? '1' : undefined,
        telefonoCliente: ctx.celular ?? undefined,
        conEnvio: false, // el envío se registra tras el pago (registrarEnvio)
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

      // 4) SIN charge de céntimos: el cliente paga el precio REDONDO y el
      //    webhook payment.received lo auto-valida por NOMBRE + monto exacto
      //    (como en sorteos). Los céntimos únicos confundían al cliente.
      const totalVenta = Number(venta?.total ?? venta?.venta?.total ?? 0);

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
        total: totalVenta,
        // El monto a yapear ES el precio normal (el webhook valida por nombre
        // + monto exacto). Debe pagarse desde la cuenta Yape del comprador.
        payAmount: totalVenta,
        numeroPago,
      };
    },
  };
}
