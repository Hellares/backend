import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoParticipanteSorteo,
  EstadoPremioSorteo,
  EstadoSorteo,
  ModalidadEntregaPremio,
  Prisma,
  Rol,
  TipoMovimientoStock,
  TipoSorteo,
  TipoNotificacion,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { StorageService } from '../storage/storage.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ClientesService } from '../clientes/clientes.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { IntegracionYapeService } from '../integracion-yape/integracion-yape.service';
import { nombreCoincideYape, nombresCoinciden } from './nombre-match.util';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';
import {
  CambiarEstadoPremioDto,
  CreateSorteoDto,
  EditarEntregaPremioDto,
  RegistrarPremioDto,
  UpdateSorteoDto,
} from './dto/sorteo.dto';

/**
 * Sorteos por redes sociales (F1/F2): registro de ganadores con premio
 * (vínculo a inventario OPCIONAL — solo premios valiosos descuentan
 * stock, vía SALIDA_SORTEO valorizada a costo) y envío trackeable
 * (agencia + foto del ticket). El ganador es una cuenta del app y ve
 * sus premios en "Mis Premios" (endpoint marketplace/mis-premios).
 */
@Injectable()
export class SorteosService {
  private readonly logger = new Logger(SorteosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly storage: StorageService,
    private readonly whatsapp: WhatsappService,
    private readonly clientes: ClientesService,
    private readonly consultasExternas: ConsultasExternasService,
    private readonly integracionYape: IntegracionYapeService,
  ) {}

  // ── Sorteos (empresa) ────────────────────────────────────────────────

  async crearSorteo(empresaId: string, usuarioId: string, dto: CreateSorteoDto) {
    return this.prisma.sorteo.create({
      data: {
        empresaId,
        sedeId: dto.sedeId,
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        canal: dto.canal,
        tipo: dto.tipo,
        fechaSorteo: dto.fechaSorteo ? new Date(dto.fechaSorteo) : undefined,
        ventaDesde: dto.ventaDesde ? new Date(dto.ventaDesde) : undefined,
        ventaHasta: dto.ventaHasta ? new Date(dto.ventaHasta) : undefined,
        precioParticipacion: dto.precioParticipacion,
        creadoPorId: usuarioId,
      },
    });
  }

  async listarSorteos(
    empresaId: string,
    opts: { estado?: EstadoSorteo; page: number; limit: number },
  ) {
    const where: Prisma.SorteoWhereInput = {
      empresaId,
      ...(opts.estado ? { estado: opts.estado } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.sorteo.findMany({
        where,
        orderBy: { fechaSorteo: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
        include: { _count: { select: { premios: true } } },
      }),
      this.prisma.sorteo.count({ where }),
    ]);
    return { data, total, page: opts.page, limit: opts.limit };
  }

  async obtenerSorteo(empresaId: string, sorteoId: string) {
    const sorteo = await this.prisma.sorteo.findFirst({
      where: { id: sorteoId, empresaId },
      include: {
        premios: { orderBy: { creadoEn: 'desc' } },
        // Captados por el bot de WhatsApp: pendientes primero, luego
        // por ticket.
        participantes: {
          orderBy: [{ estado: 'asc' }, { creadoEn: 'desc' }],
        },
      },
    });
    if (!sorteo) throw new NotFoundException('Sorteo no encontrado');
    const premios = await this.adjuntarArchivos(sorteo.premios);

    // ── Economía del sorteo ──
    // Recaudado = Σ participaciones registradas (sin anulados).
    // Costo premios = Σ valorMovimiento de las SALIDA_SORTEO (costo real
    // del kardex; premios sin stock no suman costo).
    const activos = sorteo.premios.filter(
      (p) => p.estado !== EstadoPremioSorteo.ANULADO,
    );
    const totalRecaudado = activos.reduce(
      (s, p) => s + Number(p.montoParticipacion ?? 0),
      0,
    );
    const movIds = activos
      .map((p) => p.movimientoStockId)
      .filter((id): id is string => !!id);
    const movs = movIds.length
      ? await this.prisma.movimientoStock.findMany({
          where: { id: { in: movIds } },
          select: { valorMovimiento: true },
        })
      : [];
    const costoPremios = movs.reduce(
      (s, m) => s + Number(m.valorMovimiento ?? 0),
      0,
    );

    // Imagen promocional del sorteo (Archivo SORTEO).
    const imagenes = await this.prisma.archivo.findMany({
      where: { entidadTipo: 'SORTEO', entidadId: sorteoId },
      orderBy: { creadoEn: 'desc' },
      select: { id: true, url: true, urlThumbnail: true },
    });

    // Catálogo de premios de la rifa: cuánto se sorteó de cada item, a
    // quién (con su ticket) y la imagen opcional.
    const catalogoRaw = await this.prisma.sorteoPremioCatalogo.findMany({
      where: { sorteoId },
      orderBy: { creadoEn: 'asc' },
    });
    let premiosCatalogo: any[] = [];
    if (catalogoRaw.length > 0) {
      const imagenesCatalogo = await this.prisma.archivo.findMany({
        where: {
          entidadTipo: 'SORTEO_PREMIO_CATALOGO',
          entidadId: { in: catalogoRaw.map((c) => c.id) },
        },
        orderBy: { creadoEn: 'desc' },
        select: { id: true, url: true, urlThumbnail: true, entidadId: true },
      });
      premiosCatalogo = catalogoRaw.map((c) => {
        const adjudicados = sorteo.premios.filter(
          (p) =>
            (p as any).catalogoId === c.id &&
            p.estado !== EstadoPremioSorteo.ANULADO,
        );
        return {
          ...c,
          sorteados: adjudicados.length,
          ganadores: adjudicados.map((p) => ({
            nombre: p.ganadorNombre,
            numeroTicket:
              sorteo.participantes.find((x) => x.id === p.participanteId)
                ?.numeroTicket ?? null,
          })),
          imagen:
            imagenesCatalogo.find((a) => a.entidadId === c.id) ?? null,
        };
      });
    }

    // Venta de TICKETS del bot (tipo SORTEO): recaudación adicional =
    // tickets validados × precio (los premios del ganador se registran
    // aparte — si el ganador ya pagó por tickets, registrar su premio
    // con monto 0 para no duplicar).
    let ticketsVendidos = 0;
    let recaudadoTickets = 0;
    if (
      sorteo.tipo === TipoSorteo.SORTEO &&
      sorteo.precioParticipacion != null
    ) {
      ticketsVendidos = await this.prisma.sorteoParticipante.count({
        where: { sorteoId, estado: EstadoParticipanteSorteo.ACTIVO },
      });
      recaudadoTickets =
        ticketsVendidos * Number(sorteo.precioParticipacion);
    }

    return {
      ...sorteo,
      premios,
      imagenes,
      premiosCatalogo,
      resumen: {
        totalRecaudado: totalRecaudado + recaudadoTickets,
        costoPremios,
        ganancia: totalRecaudado + recaudadoTickets - costoPremios,
        ticketsVendidos,
        recaudadoTickets,
      },
    };
  }

  async actualizarSorteo(
    empresaId: string,
    sorteoId: string,
    dto: UpdateSorteoDto,
  ) {
    const actual = await this.assertSorteo(empresaId, sorteoId);
    // Reabrir (CERRADO/FINALIZADO → ABIERTO) es solo para REGULARIZAR en
    // el app: queda marcado y el bot de WhatsApp lo ignora por completo.
    const reabre =
      dto.estado === EstadoSorteo.ABIERTO &&
      actual.estado !== EstadoSorteo.ABIERTO;
    return this.prisma.sorteo.update({
      where: { id: sorteoId },
      data: {
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        canal: dto.canal,
        tipo: dto.tipo,
        estado: dto.estado,
        ...(reabre && { reabierto: true }),
        sedeId: dto.sedeId,
        fechaSorteo: dto.fechaSorteo ? new Date(dto.fechaSorteo) : undefined,
        ventaDesde: dto.ventaDesde ? new Date(dto.ventaDesde) : undefined,
        ventaHasta: dto.ventaHasta ? new Date(dto.ventaHasta) : undefined,
        precioParticipacion: dto.precioParticipacion,
        // undefined = no tocar; [] = quitar los links del live.
        ...(dto.liveLinks !== undefined && {
          liveLinks: dto.liveLinks as unknown as Prisma.InputJsonValue,
        }),
      },
    });
  }

  // ── Premios (empresa) ────────────────────────────────────────────────

  /**
   * Registra un ganador con su premio. Si trae producto/variante,
   * descuenta stock DENTRO de la misma transacción (SALIDA_SORTEO
   * valorizada a costo — así la empresa sabe cuánto le costó el sorteo)
   * y guarda el id del movimiento para trazabilidad y reposición al
   * anular. Notifica al ganador por FCM.
   */
  async registrarPremio(
    empresaId: string,
    usuarioId: string,
    sorteoId: string,
    dto: RegistrarPremioDto,
    opts?: { permitirCerrado?: boolean; notificarGanador?: boolean },
  ) {
    const sorteo = await this.assertSorteo(empresaId, sorteoId);
    // El modo JUGAR (rifa con ánfora) opera justamente con el sorteo
    // CERRADO — ventas cerradas, se sortea. FINALIZADO tampoco admite
    // registros manuales (reabrir para regularizar).
    if (sorteo.estado !== EstadoSorteo.ABIERTO && !opts?.permitirCerrado) {
      throw new ConflictException({
        code: 'SORTEO_CERRADO',
        message:
          sorteo.estado === EstadoSorteo.FINALIZADO
            ? 'El sorteo ya finalizó — reábrelo para regularizar'
            : 'El sorteo está cerrado — reábrelo para registrar premios',
      });
    }

    // Resolver la cuenta del ganador: por usuarioId directo o por DNI
    // (el registro de cliente crea Persona+Usuario, así que el DNI de un
    // cliente registrado siempre resuelve).
    let ganadorId = dto.ganadorUsuarioId ?? null;
    if (!ganadorId) {
      if (!dto.ganadorDni) {
        throw new BadRequestException(
          'Indica ganadorUsuarioId o ganadorDni para identificar al ganador',
        );
      }
      const persona = await this.prisma.persona.findUnique({
        where: { dni: dto.ganadorDni },
        select: { usuario: { select: { id: true } } },
      });
      ganadorId = persona?.usuario?.id ?? null;
      if (!ganadorId) {
        // ¿Es un participante captado por el bot de WhatsApp? Entonces
        // tenemos nombre y celular: crear su cuenta de cliente al vuelo
        // (dinámicas: el que juega YA ganó y pasa directo a premio).
        const participante = await this.prisma.sorteoParticipante.findFirst({
          where: { empresaId, dni: dto.ganadorDni },
          orderBy: { creadoEn: 'desc' },
        });
        if (!participante) {
          throw new NotFoundException({
            code: 'GANADOR_SIN_CUENTA',
            message:
              'El DNI no tiene cuenta en el app — registra primero al ' +
              'ganador como cliente',
          });
        }
        ganadorId = await this.crearCuentaDesdeParticipante(
          empresaId,
          usuarioId,
          participante,
        );
      }
    } else {
      const ganador = await this.prisma.usuario.findUnique({
        where: { id: ganadorId },
        select: { id: true },
      });
      if (!ganador) throw new NotFoundException('El usuario ganador no existe');
    }

    const cantidad = dto.cantidad ?? 1;
    const descuentaStock = !!(dto.productoId || dto.varianteId);
    const sedeStockId = dto.sedeId ?? sorteo.sedeId;
    if (descuentaStock && !sedeStockId) {
      throw new BadRequestException(
        'Para descontar stock indica la sede (del sorteo o del premio)',
      );
    }

    const premio = await this.prisma.$transaction(async (tx) => {
      let movimientoStockId: string | undefined;

      if (descuentaStock) {
        // Rama por variante O por producto — NUNCA ambos ids (el stock
        // de variante tiene productoId = null).
        const stock = dto.varianteId
          ? await tx.productoStock.findFirst({
              where: { sedeId: sedeStockId!, varianteId: dto.varianteId },
            })
          : await tx.productoStock.findFirst({
              where: {
                sedeId: sedeStockId!,
                productoId: dto.productoId!,
                varianteId: null,
              },
            });
        if (!stock) {
          throw new ConflictException({
            code: 'STOCK_NO_CONFIGURADO',
            message: 'El producto no tiene stock configurado en esa sede',
          });
        }
        const disponible =
          stock.stockActual -
          stock.stockReservado -
          stock.stockReservadoVenta -
          stock.stockReservadoCombo -
          stock.stockReservadoCotizacion -
          stock.stockDanado -
          stock.stockEnGarantia;
        if (cantidad > disponible) {
          throw new ConflictException({
            code: 'STOCK_INSUFICIENTE',
            message:
              `Stock insuficiente para "${dto.descripcion}". ` +
              `Disponible: ${disponible}, requerido: ${cantidad}.`,
          });
        }
        const nuevoStock = stock.stockActual - cantidad;
        await tx.productoStock.update({
          where: { id: stock.id },
          data: { stockActual: nuevoStock },
        });
        const mov = await crearMovimientoStockConValoracion(tx, {
          sedeId: sedeStockId!,
          empresaId,
          productoStockId: stock.id,
          tipo: TipoMovimientoStock.SALIDA_SORTEO,
          tipoDocumento: 'SORTEO',
          numeroDocumento: sorteo.titulo.slice(0, 50),
          cantidadAnterior: stock.stockActual,
          cantidad: -cantidad,
          cantidadNueva: nuevoStock,
          motivo: `Premio sorteo "${sorteo.titulo}" → ${dto.ganadorNombre}`,
          usuarioId,
          // undefined → el helper toma el precioCosto actual del stock.
        });
        movimientoStockId = mov.id;
      }

      return tx.sorteoPremio.create({
        data: {
          sorteoId,
          empresaId,
          catalogoId: dto.catalogoId,
          participanteId: dto.participanteId,
          recibeNombre: dto.recibeNombre,
          recibeDni: dto.recibeDni,
          // EFECTIVO 💸: sin envío por agencia — el bot le confirma al
          // ganador su número de abono (abonoNumero queda null hasta eso).
          esEfectivo: dto.esEfectivo ?? false,
          ganadorId: ganadorId!,
          ganadorDni: dto.ganadorDni,
          ganadorNombre: dto.ganadorNombre,
          ganadorCelular: dto.ganadorCelular,
          descripcion: dto.descripcion,
          productoId: dto.productoId,
          varianteId: dto.varianteId,
          cantidad,
          movimientoStockId,
          // Lo pagado por ESTE ganador — editable; default el precio de
          // participación del sorteo.
          montoParticipacion:
            dto.montoParticipacion ?? sorteo.precioParticipacion,
          modalidad: dto.modalidad,
          agenciaNombre: dto.agenciaNombre,
          destinoDepartamento: dto.destinoDepartamento,
          destinoProvincia: dto.destinoProvincia,
          agenciaDireccion: dto.agenciaDireccion,
          observaciones: dto.observaciones,
          registradoPorId: usuarioId,
        },
      });
    });

    // FCM al ganador (best-effort, nunca tumba el registro).
    this.notificarGanador(premio.id, empresaId, ganadorId!, {
      titulo: '🎉 ¡Ganaste un premio!',
      cuerpoBase: dto.descripcion,
      action: 'ganado',
    });
    // WhatsApp al ganador (best-effort): "¡GANASTE!" + arranca el flujo
    // de dirección (físico) o de número de Yape (efectivo). Solo SORTEO
    // y BINGO — en DINÁMICA la activación ya atendió al jugador; el
    // auto-premio pasa notificarGanador=false por si acaso.
    if (
      opts?.notificarGanador !== false &&
      sorteo.tipo !== TipoSorteo.DINAMICA
    ) {
      await this.whatsapp
        .notificarPremioGanado(empresaId, premio.id)
        .catch((e) =>
          this.logger.warn(
            `WhatsApp ganador premio ${premio.id}: ${(e as Error).message}`,
          ),
        );
    }
    // Refresco instantáneo del detalle en otros devices.
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId });

    return premio;
  }

  /**
   * Transición de estado del premio. ANULADO repone el stock si el
   * premio lo descontó (ENTRADA_SORTEO_ANULADO). ENVIADO notifica al
   * ganador con los datos de agencia/retiro.
   */
  async cambiarEstadoPremio(
    empresaId: string,
    usuarioId: string,
    premioId: string,
    dto: CambiarEstadoPremioDto,
  ) {
    const premio = await this.assertPremio(empresaId, premioId);
    if (
      premio.estado === EstadoPremioSorteo.ENTREGADO ||
      premio.estado === EstadoPremioSorteo.ANULADO
    ) {
      throw new ConflictException({
        code: 'ESTADO_FINAL',
        message: `El premio ya está ${premio.estado} — no admite cambios`,
      });
    }
    if (dto.estado === EstadoPremioSorteo.REGISTRADO) {
      throw new BadRequestException('No se puede volver a REGISTRADO');
    }

    const actualizado = await this.prisma.$transaction(async (tx) => {
      if (
        dto.estado === EstadoPremioSorteo.ANULADO &&
        premio.movimientoStockId
      ) {
        // Reposición del stock que el premio descontó.
        const mov = await tx.movimientoStock.findUnique({
          where: { id: premio.movimientoStockId },
          select: { productoStockId: true, sedeId: true },
        });
        if (mov) {
          const stock = await tx.productoStock.findUnique({
            where: { id: mov.productoStockId },
          });
          if (stock) {
            const nuevoStock = stock.stockActual + premio.cantidad;
            await tx.productoStock.update({
              where: { id: stock.id },
              data: { stockActual: nuevoStock },
            });
            await crearMovimientoStockConValoracion(tx, {
              sedeId: mov.sedeId,
              empresaId,
              productoStockId: stock.id,
              tipo: TipoMovimientoStock.ENTRADA_SORTEO_ANULADO,
              tipoDocumento: 'SORTEO',
              cantidadAnterior: stock.stockActual,
              cantidad: premio.cantidad,
              cantidadNueva: nuevoStock,
              motivo: `Anulación premio sorteo — ${premio.descripcion}`,
              usuarioId,
            });
          }
        }
      }

      return tx.sorteoPremio.update({
        where: { id: premioId },
        data: {
          estado: dto.estado,
          observaciones: dto.observaciones ?? premio.observaciones,
          // Datos del despacho: solo se pisan si vienen (permite marcar
          // estados sin borrar lo ya registrado).
          envioNumeroOrden: dto.envioNumeroOrden ?? undefined,
          envioCodigo: dto.envioCodigo ?? undefined,
          envioClave: dto.envioClave ?? undefined,
          enviadoEn:
            dto.estado === EstadoPremioSorteo.ENVIADO && !premio.enviadoEn
              ? new Date()
              : undefined,
          entregadoEn:
            dto.estado === EstadoPremioSorteo.ENTREGADO
              ? new Date()
              : undefined,
        },
      });
    });

    // Notificar solo en la TRANSICIÓN a ENVIADO (re-enviar el mismo
    // estado es "editar datos de envío" y no debe duplicar el push).
    if (
      dto.estado === EstadoPremioSorteo.ENVIADO &&
      premio.estado !== EstadoPremioSorteo.ENVIADO
    ) {
      const destino = [premio.destinoProvincia, premio.destinoDepartamento]
        .filter(Boolean)
        .join(', ');
      const detalle =
        premio.modalidad === 'ENVIO_AGENCIA'
          ? `Enviado por ${premio.agenciaNombre ?? 'agencia'}` +
            (destino ? ` a ${destino}` : '') +
            (premio.agenciaDireccion
              ? ` — recoge en ${premio.agenciaDireccion}`
              : '')
          : 'Listo para recoger en tienda';
      this.notificarGanador(premio.id, empresaId, premio.ganadorId, {
        titulo: '📦 Tu premio está en camino',
        cuerpoBase: `${premio.descripcion}. ${detalle}`,
        action: 'enviado',
      });
    }

    this.realtime.notifySorteoCambiado({
      empresaId,
      sorteoId: premio.sorteoId,
    });
    return actualizado;
  }

  /**
   * Sube la foto del ticket de envío (SORTEO_PREMIO/EVIDENCIA). El
   * contexto se fuerza aquí — el endpoint no permite otras entidades.
   */
  async subirTicketEnvio(
    empresaId: string,
    usuarioId: string,
    premioId: string,
    file: any,
  ) {
    const premio = await this.assertPremio(empresaId, premioId);
    const archivo = await this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: 'SORTEO_PREMIO',
      entidadId: premioId,
      categoria: 'EVIDENCIA',
      subidoPor: usuarioId,
    });

    // Si la empresa tiene WhatsApp vinculado, el ticket sale solo al
    // ganador (imagen + plantilla). Best-effort: un fallo aquí NUNCA
    // deshace la subida; el app usa whatsappEnviado para ofrecer el
    // envío manual como fallback.
    let whatsappEnviado = false;
    try {
      whatsappEnviado = await this.whatsapp.enviarTicketPremio(
        empresaId,
        premioId,
        archivo.url,
      );
      if (whatsappEnviado) {
        // Chip "ENVIADO POR WSP" en la card del premio.
        await this.prisma.sorteoPremio.update({
          where: { id: premioId },
          data: { whatsappEnviadoEn: new Date() },
        });
      }
    } catch (e) {
      this.logger.warn(
        `WhatsApp del ticket ${premioId} falló: ${(e as Error).message}`,
      );
    }
    this.realtime.notifySorteoCambiado({
      empresaId,
      sorteoId: premio.sorteoId,
    });
    return { ...archivo, whatsappEnviado };
  }

  /** Marca el rótulo de envío como impreso (idempotente). */
  async marcarRotuloImpreso(empresaId: string, premioId: string) {
    await this.assertPremio(empresaId, premioId);
    return this.prisma.sorteoPremio.update({
      where: { id: premioId },
      data: { rotuloImpresoEn: new Date() },
    });
  }

  /** Foto del PREMIO ganado (SORTEO_PREMIO/PRINCIPAL). */
  async subirFotoPremio(
    empresaId: string,
    usuarioId: string,
    premioId: string,
    file: any,
  ) {
    await this.assertPremio(empresaId, premioId);
    return this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: 'SORTEO_PREMIO',
      entidadId: premioId,
      categoria: 'PRINCIPAL',
      subidoPor: usuarioId,
    });
  }

  /** Imagen promocional del SORTEO (SORTEO/BANNER). */
  async subirImagenSorteo(
    empresaId: string,
    usuarioId: string,
    sorteoId: string,
    file: any,
  ) {
    await this.assertSorteo(empresaId, sorteoId);
    return this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: 'SORTEO',
      entidadId: sorteoId,
      categoria: 'BANNER',
      subidoPor: usuarioId,
    });
  }

  /**
   * Crea la cuenta de cliente de un participante del bot (Persona +
   * Usuario + relaciones — registrarCliente maneja los 3 casos). Nombres
   * oficiales de RENIEC si responde; si no, split del nombre del bot
   * (últimas 2 palabras = apellidos). Devuelve el usuarioId del ganador.
   */
  private async crearCuentaDesdeParticipante(
    empresaId: string,
    registradoPorId: string,
    participante: { dni: string; nombre: string; celular: string },
  ): Promise<string> {
    let nombres = '';
    let apellidos = '';
    try {
      // DNI (8) → RENIEC; CE de extranjería (9) → Migraciones.
      const datos =
        participante.dni.length === 9
          ? await this.consultasExternas.consultarCee(participante.dni)
          : await this.consultasExternas.consultarDni(participante.dni);
      nombres = datos.nombres ?? '';
      apellidos = [datos.apellidoPaterno, datos.apellidoMaterno]
        .filter(Boolean)
        .join(' ');
    } catch {
      // RENIEC/Migraciones caído — usamos lo que capturó el bot.
    }
    if (!nombres || !apellidos) {
      const partes = participante.nombre.trim().split(/\s+/);
      apellidos = partes.length >= 3
        ? partes.slice(-2).join(' ')
        : partes.length === 2
          ? partes[1]
          : 'SIN APELLIDO';
      nombres = partes.length >= 3
        ? partes.slice(0, -2).join(' ')
        : partes[0];
    }
    await this.clientes.registrarCliente(
      {
        dni: participante.dni,
        nombres,
        apellidos,
        telefono: participante.celular.slice(-9),
      } as any,
      empresaId,
      registradoPorId,
    );
    const persona = await this.prisma.persona.findUnique({
      where: { dni: participante.dni },
      select: { usuario: { select: { id: true } } },
    });
    if (!persona?.usuario?.id) {
      throw new NotFoundException({
        code: 'GANADOR_SIN_CUENTA',
        message: 'No se pudo crear la cuenta del ganador — regístralo como cliente',
      });
    }
    this.logger.log(
      `Cuenta de cliente auto-creada para participante DNI ${participante.dni}`,
    );
    return persona.usuario.id;
  }

  // ── Participantes (captados por el bot de WhatsApp) ─────────────────

  // Matcher de nombres compartido con el bot — vive en
  // nombre-match.util.ts (sin dependencias, evita ciclos de import).
  static nombreCoincideYape = nombreCoincideYape;
  static nombresCoinciden = nombresCoinciden;

  /** Ids de pagos api-yape YA consumidos por alguna participación. */
  private async pagosYapeUsados(empresaId: string): Promise<Set<string>> {
    const filas = await this.prisma.sorteoParticipante.findMany({
      where: { empresaId, yapePaymentId: { not: null } },
      select: { yapePaymentId: true },
    });
    // CONVIVENCIA con el agente IA: un yape que ya pagó una VENTA
    // (PagoVenta.referencia = operationCode || payment.id del webhook) no
    // puede sugerirse ni consumirse para validar una participación — un
    // solo pago validaría dos cosas. Ventana 48h: los pagos de api-yape
    // que se cruzan viven en la de 24h.
    const pagosVenta = await this.prisma.pagoVenta.findMany({
      where: {
        venta: { empresaId },
        referencia: { not: null },
        creadoEn: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
      },
      select: { referencia: true },
    });
    return new Set([
      ...filas
        .map((f) => f.yapePaymentId)
        .filter((id): id is string => !!id),
      ...pagosVenta
        .map((p) => p.referencia)
        .filter((r): r is string => !!r),
    ]);
  }

  /** ¿Este pago ya fue consumido (participación o venta)? Compara por el
   *  id del payment Y por su operationCode — PagoVenta guarda
   *  `operationCode || id`, así que hay que mirar ambos. */
  private static pagoConsumido(
    usados: Set<string>,
    pago: { id?: string | null; operationCode?: string | null },
  ): boolean {
    return (
      (!!pago.id && usados.has(pago.id)) ||
      (!!pago.operationCode && usados.has(pago.operationCode))
    );
  }

  /**
   * Al VALIDAR una participación (auto o manual), vincula el pago Yape
   * que le calza (nombre/pagador + monto, respetando la ventana del
   * anticipado) y lo marca CONSUMIDO — el mismo yape no puede validar
   * ni sugerirse en otra participación. Best-effort: sin pago que
   * calce, no pasa nada.
   */
  private async vincularPagoYape(empresaId: string, participanteId: string) {
    try {
      const p = await this.prisma.sorteoParticipante.findFirst({
        where: { id: participanteId, empresaId },
        include: { sorteo: { select: { precioParticipacion: true } } },
      });
      if (!p || p.yapePaymentId) return;
      const pagos =
        await this.integracionYape.listarPagosRecientes(empresaId);
      if (pagos.length === 0) return;
      const usados = await this.pagosYapeUsados(empresaId);
      const n = p.compraId
        ? await this.prisma.sorteoParticipante.count({
            where: { compraId: p.compraId, empresaId },
          })
        : 1;
      const precio = p.sorteo.precioParticipacion
        ? Number(p.sorteo.precioParticipacion)
        : null;
      const esperado = precio != null ? precio * n : null;
      const desde = p.yapeAnticipadoEn
        ? 0
        : p.creadoEn.getTime() - 5 * 60_000;
      const candidatos = pagos.filter((pg) => {
        if (SorteosService.pagoConsumido(usados, pg)) return false;
        const ts = new Date(pg.receivedAt).getTime();
        if (!Number.isFinite(ts) || ts < desde) return false;
        return (
          nombresCoinciden(pg.senderName, p.nombre) ||
          nombresCoinciden(pg.senderName, p.pagadorNombre)
        );
      });
      if (candidatos.length === 0) return;
      const mejor =
        candidatos.find(
          (c) => esperado != null && Math.abs(c.amount - esperado) < 0.005,
        ) ?? candidatos[0];
      await this.prisma.sorteoParticipante.updateMany({
        where: p.compraId
          ? { compraId: p.compraId, empresaId }
          : { id: p.id, empresaId },
        data: { yapePaymentId: mejor.id },
      });
      this.logger.log(
        `💸 Pago Yape ${mejor.id} (S/ ${mejor.amount} de "${mejor.senderName}") CONSUMIDO por participación ${p.id}`,
      );
    } catch (e) {
      this.logger.warn(
        `vincularPagoYape falló (participante ${participanteId}): ${(e as Error).message}`,
      );
    }
  }

  /**
   * Sugerencias de pago Yape/Plin para la cola de validación: cruza los
   * pagos RECIBIDOS recientes de api-yape (sin charge — los yapes
   * "sueltos" de sorteos) contra los participantes PENDIENTE_PAGO por
   * NOMBRE (el del jugador o el del pagador que capturó el bot) y marca
   * si el monto calza con lo esperado (tickets × precio). La decisión
   * sigue siendo de la empresa — esto solo le ahorra mirar el celular.
   */
  async sugerirPagosYape(empresaId: string) {
    const pendientes = await this.prisma.sorteoParticipante.findMany({
      where: {
        empresaId,
        estado: EstadoParticipanteSorteo.PENDIENTE_PAGO,
        sorteo: { estado: EstadoSorteo.ABIERTO, reabierto: false },
      },
      orderBy: { creadoEn: 'desc' },
      include: { sorteo: { select: { precioParticipacion: true } } },
    });
    if (pendientes.length === 0) return { sugerencias: [] };
    const pagosTodos =
      await this.integracionYape.listarPagosRecientes(empresaId);
    // Pagos ya CONSUMIDOS por otra participación o por una VENTA: fuera.
    const usados = await this.pagosYapeUsados(empresaId);
    const pagos = pagosTodos.filter(
      (pg) => !SorteosService.pagoConsumido(usados, pg),
    );
    if (pagos.length === 0) return { sugerencias: [] };

    // Tamaño de cada COMPRA (n tickets = un solo pago por n × precio).
    const tamCompra = new Map<string, number>();
    for (const p of pendientes) {
      if (p.compraId) {
        tamCompra.set(p.compraId, (tamCompra.get(p.compraId) ?? 0) + 1);
      }
    }

    const vistos = new Set<string>();
    const sugerencias: any[] = [];
    for (const p of pendientes) {
      const clave = p.compraId ?? p.id;
      if (vistos.has(clave)) continue;
      // Solo pagos POSTERIORES al registro de ESTA participación (el
      // flujo es registrarse → pagar): sin esto, un yape viejo de la
      // misma persona se sugería en cada participación nueva. 5 min de
      // tolerancia por desfase de relojes. EXCEPCIÓN: si el cliente
      // declaró "ya yapeé antes de registrarme" (yapeAnticipadoEn), se
      // consideran también los pagos previos de la ventana de 24h.
      const desde = p.yapeAnticipadoEn
        ? 0
        : p.creadoEn.getTime() - 5 * 60_000;
      const candidatos = pagos.filter((pg) => {
        const ts = new Date(pg.receivedAt).getTime();
        if (!Number.isFinite(ts) || ts < desde) return false;
        return (
          SorteosService.nombresCoinciden(pg.senderName, p.nombre) ||
          SorteosService.nombresCoinciden(pg.senderName, p.pagadorNombre)
        );
      });
      if (candidatos.length === 0) continue;
      vistos.add(clave);
      const n = p.compraId ? (tamCompra.get(p.compraId) ?? 1) : 1;
      const precio = p.sorteo.precioParticipacion
        ? Number(p.sorteo.precioParticipacion)
        : null;
      const esperado = precio != null ? precio * n : null;
      // Preferir el pago cuyo monto calza EXACTO con lo esperado.
      const mejor =
        candidatos.find(
          (c) => esperado != null && Math.abs(c.amount - esperado) < 0.005,
        ) ?? candidatos[0];
      sugerencias.push({
        participanteId: p.id,
        compraId: p.compraId ?? null,
        senderName: mejor.senderName,
        amount: mejor.amount,
        provider: mejor.provider,
        receivedAt: mejor.receivedAt,
        montoEsperado: esperado,
        montoCoincide:
          esperado != null && Math.abs(mejor.amount - esperado) < 0.005,
        // Yape ANTERIOR al registro ("yape en el aire" declarado): el
        // admin lo ve marcado — estos jamás se auto-validan.
        anticipado:
          new Date(mejor.receivedAt).getTime() < p.creadoEn.getTime(),
      });
    }
    return { sugerencias };
  }

  /**
   * AUTO-VALIDACIÓN por Yape (webhook `payment.received` de api-yape):
   * si el pago calza por NOMBRE (jugador o pagador del bot) y MONTO
   * EXACTO (tickets × precio) con UNA SOLA participación pendiente y es
   * POSTERIOR a su registro, se valida sola — ticket asignado y
   * confirmación del bot, sin tocar el app. Ambiguo, sin precio o monto
   * distinto → no toca nada (queda el chip de sugerencia y la empresa
   * decide a mano).
   */
  async autoValidarPorPagoYape(
    empresaId: string,
    pago: {
      id?: string | null;
      senderName?: string | null;
      amount?: number | null;
      receivedAt?: string | null;
      operationCode?: string | null;
    },
  ) {
    const monto = Number(pago?.amount ?? 0);
    if (!pago?.senderName || !(monto > 0)) {
      return { accion: 'pago-sin-datos' };
    }
    // Replay/duplicado: un pago ya consumido (por participación O por una
    // venta del agente) jamás valida otra vez.
    if (pago.id || pago.operationCode) {
      const usados = await this.pagosYapeUsados(empresaId);
      if (SorteosService.pagoConsumido(usados, pago)) {
        return { accion: 'pago-ya-usado' };
      }
    }
    const pendientes = await this.prisma.sorteoParticipante.findMany({
      where: {
        empresaId,
        estado: EstadoParticipanteSorteo.PENDIENTE_PAGO,
        sorteo: { estado: EstadoSorteo.ABIERTO, reabierto: false },
      },
      orderBy: { creadoEn: 'desc' },
      include: { sorteo: { select: { precioParticipacion: true } } },
    });
    if (pendientes.length === 0) return { accion: 'sin-pendientes' };

    const ts = pago.receivedAt
      ? new Date(pago.receivedAt).getTime()
      : Date.now();
    const tamCompra = new Map<string, number>();
    for (const p of pendientes) {
      if (p.compraId) {
        tamCompra.set(p.compraId, (tamCompra.get(p.compraId) ?? 0) + 1);
      }
    }
    const vistos = new Set<string>();
    const matches: typeof pendientes = [];
    for (const p of pendientes) {
      const clave = p.compraId ?? p.id;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      // El pago debe ser POSTERIOR al registro (flujo registrarse→pagar).
      if (!Number.isFinite(ts) || ts < p.creadoEn.getTime() - 5 * 60_000) {
        continue;
      }
      const nombreOk =
        SorteosService.nombresCoinciden(pago.senderName, p.nombre) ||
        SorteosService.nombresCoinciden(pago.senderName, p.pagadorNombre);
      if (!nombreOk) continue;
      const precio = p.sorteo.precioParticipacion
        ? Number(p.sorteo.precioParticipacion)
        : null;
      if (precio == null) continue; // sin precio no hay monto esperado
      const n = p.compraId ? (tamCompra.get(p.compraId) ?? 1) : 1;
      if (Math.abs(monto - precio * n) >= 0.005) continue;
      matches.push(p);
    }
    if (matches.length === 0) return { accion: 'sin-match-exacto' };
    if (matches.length > 1) {
      this.logger.log(
        `Auto-validación Yape ambigua (${matches.length} pendientes calzan con "${pago.senderName}" S/ ${monto}) — la empresa decide`,
      );
      return { accion: 'ambiguo' };
    }

    // registradoPor exige un Usuario real (FK): el rol STAFF activo más
    // antiguo de la empresa (normalmente el dueño/admin). Los CLIENTES
    // también viven en EmpresaUsuarioRol — jamás deben ser el validador.
    const admin = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null,
        rol: { not: Rol.CLIENTE },
      },
      orderBy: { creadoEn: 'asc' },
      select: { usuarioId: true },
    });
    if (!admin) return { accion: 'sin-usuario-validador' };

    const p = matches[0];
    await this.cambiarEstadoParticipante(
      empresaId,
      admin.usuarioId,
      p.id,
      EstadoParticipanteSorteo.ACTIVO,
    );
    this.logger.log(
      `✅ Participante ${p.id} (${p.nombre}) AUTO-VALIDADO por Yape de S/ ${monto} de "${pago.senderName}"`,
    );
    return { accion: 'participante-auto-validado', participanteId: p.id };
  }

  /**
   * Cola global: participantes con pago por validar de todos los
   * sorteos/dinámicas ABIERTOS de la empresa.
   */
  async listarParticipantesPendientes(empresaId: string) {
    return this.prisma.sorteoParticipante.findMany({
      where: {
        empresaId,
        estado: EstadoParticipanteSorteo.PENDIENTE_PAGO,
        sorteo: { estado: EstadoSorteo.ABIERTO },
      },
      orderBy: { creadoEn: 'desc' },
      include: {
        sorteo: {
          select: {
            id: true,
            titulo: true,
            tipo: true,
            precioParticipacion: true,
          },
        },
      },
    });
  }

  /**
   * Valida/rechaza un participante. Al ACTIVAR se asigna el correlativo
   * del ticket (orden de validación) y el bot le confirma por WhatsApp.
   * En DINÁMICAS además se crea el premio AUTOMÁTICAMENTE (el que juega
   * ya ganó y el bot ya capturó todos sus datos): la card queda lista
   * para subir el ticket, imprimir el rótulo, etc.
   */
  async cambiarEstadoParticipante(
    empresaId: string,
    usuarioId: string,
    participanteId: string,
    estado: EstadoParticipanteSorteo,
  ) {
    const participante = await this.prisma.sorteoParticipante.findFirst({
      where: { id: participanteId, empresaId },
      include: {
        sorteo: {
          select: {
            id: true,
            titulo: true,
            tipo: true,
            descripcion: true,
            precioParticipacion: true,
          },
        },
      },
    });
    if (!participante) {
      throw new NotFoundException('Participante no encontrado');
    }

    // COMPRA de tickets: un solo pago → un solo veredicto. Validar (o
    // rechazar) cualquier fila de la compra opera sobre TODAS las que
    // sigan pendientes, con tickets CONSECUTIVOS.
    const filas = participante.compraId
      ? await this.prisma.sorteoParticipante.findMany({
          where: {
            compraId: participante.compraId,
            empresaId,
            estado: EstadoParticipanteSorteo.PENDIENTE_PAGO,
          },
          orderBy: { creadoEn: 'asc' },
          select: { id: true },
        })
      : [{ id: participante.id }];

    if (estado === EstadoParticipanteSorteo.ACTIVO) {
      const max = await this.prisma.sorteoParticipante.aggregate({
        where: { sorteoId: participante.sorteoId },
        _max: { numeroTicket: true },
      });
      let siguiente = (max._max.numeroTicket ?? 0) + 1;
      const ahora = new Date();
      // BINGO: cada cartilla nace con su grilla 5×5 al activarse.
      const esBingo = participante.sorteo.tipo === TipoSorteo.BINGO;
      await this.prisma.$transaction(
        filas.map((f) => {
          // Fila ya activada antes (re-validación): conserva su ticket.
          const yaTiene =
            f.id === participante.id && participante.numeroTicket != null;
          return this.prisma.sorteoParticipante.update({
            where: { id: f.id },
            data: {
              estado,
              ...(yaTiene
                ? {}
                : { numeroTicket: siguiente++, activadoEn: ahora }),
              ...(esBingo && !yaTiene
                ? { cartilla: this.generarCartilla() }
                : {}),
            },
          });
        }),
      );
    } else {
      await this.prisma.sorteoParticipante.updateMany({
        where: { id: { in: filas.map((f) => f.id) } },
        data: { estado },
      });
    }
    const actualizado =
      (await this.prisma.sorteoParticipante.findFirst({
        where: { id: participante.id },
      })) ?? participante;

    // Al ACTIVAR: consumir el pago Yape que le calza (si hay) — un
    // mismo yape no valida dos participaciones. Best-effort.
    if (estado === EstadoParticipanteSorteo.ACTIVO) {
      await this.vincularPagoYape(empresaId, participante.id);
    }

    // Confirmación por WhatsApp + pedido de datos de envío (el bot deja
    // la conversación en el paso correspondiente). Best-effort.
    if (estado === EstadoParticipanteSorteo.ACTIVO) {
      await this.whatsapp
        .notificarActivacionParticipante(empresaId, participante.id)
        .catch((e) =>
          this.logger.warn(
            `Confirmación WhatsApp participante ${participanteId}: ${(e as Error).message}`,
          ),
        );
    }

    // DINÁMICA: el jugador validado YA ganó — crear su premio de una vez
    // con los datos del bot. Best-effort: si falla (p.ej. RENIEC caído al
    // crear la cuenta), la activación queda y el 🏆 manual sigue de
    // respaldo en el app.
    let premioCreado = false;
    if (
      estado === EstadoParticipanteSorteo.ACTIVO &&
      participante.sorteo.tipo === TipoSorteo.DINAMICA
    ) {
      premioCreado = await this.crearPremioDesdeParticipante(
        empresaId,
        usuarioId,
        participante,
      );
    }
    this.realtime.notifySorteoCambiado({
      empresaId,
      sorteoId: participante.sorteoId,
    });
    return { ...actualizado, premioCreado };
  }

  /**
   * Premio automático de la dinámica (idempotente: si el DNI ya tiene
   * premio no anulado en el sorteo, no duplica). Devuelve true si creó.
   */
  private async crearPremioDesdeParticipante(
    empresaId: string,
    usuarioId: string,
    participante: {
      id: string;
      dni: string;
      nombre: string;
      celular: string;
      recibeNombre: string | null;
      recibeDni: string | null;
      agenciaNombre: string | null;
      destinoDepartamento: string | null;
      destinoProvincia: string | null;
      agenciaDireccion: string | null;
      sorteo: {
        id: string;
        titulo: string;
        descripcion: string | null;
        precioParticipacion: Prisma.Decimal | null;
      };
    },
  ): Promise<boolean> {
    try {
      // Idempotente POR PARTICIPACION (el mismo DNI puede jugar varias
      // veces: cada jugada validada genera su propio premio).
      const existente = await this.prisma.sorteoPremio.findFirst({
        where: { participanteId: participante.id },
        select: { id: true },
      });
      if (existente) return false;

      const conAgencia = !!participante.agenciaNombre?.trim();
      await this.registrarPremio(empresaId, usuarioId, participante.sorteo.id, {
        participanteId: participante.id,
        recibeNombre: participante.recibeNombre ?? undefined,
        recibeDni: participante.recibeDni ?? undefined,
        ganadorDni: participante.dni,
        ganadorNombre: participante.nombre,
        ganadorCelular: participante.celular.slice(-9),
        descripcion:
          participante.sorteo.descripcion?.trim() ||
          participante.sorteo.titulo,
        modalidad: conAgencia
          ? ModalidadEntregaPremio.ENVIO_AGENCIA
          : ModalidadEntregaPremio.RETIRO_TIENDA,
        agenciaNombre: participante.agenciaNombre ?? undefined,
        destinoDepartamento: participante.destinoDepartamento ?? undefined,
        destinoProvincia: participante.destinoProvincia ?? undefined,
        agenciaDireccion: participante.agenciaDireccion ?? undefined,
        // (sin notificar: la confirmación de activación ya le habló)
        montoParticipacion: participante.sorteo.precioParticipacion
          ? Number(participante.sorteo.precioParticipacion)
          : undefined,
      } as RegistrarPremioDto,
      { notificarGanador: false });
      this.logger.log(
        `Premio automático de dinámica creado (DNI ${participante.dni}, sorteo ${participante.sorteo.id})`,
      );
      return true;
    } catch (e) {
      // Los errores de Prisma (p.ej. P2002 unique) pueden venir con
      // message vacío — loguear también code/nombre para no debuggear
      // a ciegas.
      const err = e as Error & { code?: string };
      this.logger.warn(
        `Premio automático de dinámica falló (DNI ${participante.dni}): ` +
          (err.message || err.code || err.name || String(e)),
      );
      return false;
    }
  }

  // ── Mis Premios (cliente del app) ────────────────────────────────────

  async misPremios(usuarioId: string) {
    const premios = await this.prisma.sorteoPremio.findMany({
      where: {
        ganadorId: usuarioId,
        estado: { not: EstadoPremioSorteo.ANULADO },
      },
      orderBy: { creadoEn: 'desc' },
      include: {
        sorteo: {
          select: {
            titulo: true,
            fechaSorteo: true,
            canal: true,
            sedeId: true,
            empresa: { select: { id: true, nombre: true, logo: true, telefono: true } },
          },
        },
      },
    });
    return this.enriquecerPremiosCliente(premios);
  }

  /**
   * El GANADOR indica dónde recogerá su premio — el ÚNICO dato que puede
   * tocar (si no lo hace, la empresa lo llena como siempre). Solo antes
   * del despacho; fija la modalidad en ENVIO_AGENCIA.
   */
  async elegirAgenciaMiPremio(
    usuarioId: string,
    premioId: string,
    dto: {
      agenciaNombre: string;
      destinoDepartamento?: string;
      destinoProvincia?: string;
      agenciaDireccion?: string;
    },
  ) {
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: { id: premioId, ganadorId: usuarioId },
    });
    if (!premio) throw new NotFoundException('Premio no encontrado');
    // Solo mientras está REGISTRADO: desde PREPARANDO la tienda ya está
    // armando el paquete y el cambio se coordina con ella (la empresa sí
    // puede seguir corrigiendo vía editarEntregaPremio).
    if (premio.estado !== EstadoPremioSorteo.REGISTRADO) {
      throw new ConflictException({
        code: 'PREMIO_YA_EN_PROCESO',
        message:
          premio.estado === EstadoPremioSorteo.PREPARANDO
            ? 'Tu premio ya está siendo preparado — coordina el cambio con la tienda'
            : 'Tu premio ya fue despachado — coordina el cambio con la tienda',
      });
    }
    const actualizado = await this.prisma.sorteoPremio.update({
      where: { id: premioId },
      data: {
        modalidad: 'ENVIO_AGENCIA',
        agenciaNombre: dto.agenciaNombre,
        destinoDepartamento: dto.destinoDepartamento,
        destinoProvincia: dto.destinoProvincia,
        agenciaDireccion: dto.agenciaDireccion,
      },
    });
    // La empresa ve la agencia elegida sin refrescar a mano (mismo
    // notify que editarEntregaPremio).
    this.realtime.notifySorteoCambiado({
      empresaId: premio.empresaId,
      sorteoId: premio.sorteoId,
    });
    return actualizado;
  }

  async miPremioDetalle(usuarioId: string, premioId: string) {
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: { id: premioId, ganadorId: usuarioId },
      include: {
        sorteo: {
          select: {
            titulo: true,
            fechaSorteo: true,
            canal: true,
            sedeId: true,
            empresa: { select: { id: true, nombre: true, logo: true, telefono: true } },
          },
        },
      },
    });
    if (!premio) throw new NotFoundException('Premio no encontrado');
    const [enriquecido] = await this.enriquecerPremiosCliente([premio]);
    return enriquecido;
  }

  /**
   * La EMPRESA corrige la entrega de un premio (modalidad y/o agencia)
   * — p.ej. quedó en RETIRO_TIENDA por error al registrar. Mismo guard
   * de estados que elegirAgenciaMiPremio: solo antes del despacho.
   */
  async editarEntregaPremio(
    empresaId: string,
    premioId: string,
    dto: EditarEntregaPremioDto,
  ) {
    const premio = await this.assertPremio(empresaId, premioId);
    if (
      premio.estado !== EstadoPremioSorteo.REGISTRADO &&
      premio.estado !== EstadoPremioSorteo.PREPARANDO
    ) {
      throw new ConflictException({
        code: 'PREMIO_YA_DESPACHADO',
        message: `El premio ya está ${premio.estado} — la entrega ya no se puede modificar`,
      });
    }
    const actualizado = await this.prisma.sorteoPremio.update({
      where: { id: premioId },
      data: {
        modalidad: dto.modalidad,
        // undefined = no tocar (permite cambiar solo la modalidad).
        agenciaNombre: dto.agenciaNombre,
        destinoDepartamento: dto.destinoDepartamento,
        destinoProvincia: dto.destinoProvincia,
        agenciaDireccion: dto.agenciaDireccion,
        // Si deja de viajar, el rótulo impreso pierde validez (el chip
        // IMPRESO no debe quedar mintiendo).
        ...(dto.modalidad === ModalidadEntregaPremio.RETIRO_TIENDA
          ? { rotuloImpresoEn: null }
          : {}),
      },
    });
    this.realtime.notifySorteoCambiado({
      empresaId,
      sorteoId: premio.sorteoId,
    });
    return actualizado;
  }

  /**
   * Última entrega POR AGENCIA registrada para un DNI — para prellenar
   * el registro cuando el mismo participante gana otra vez (sus datos
   * de agencia/destino casi nunca cambian entre sorteos).
   */
  async ultimaEntregaGanador(empresaId: string, dni: string) {
    if (!dni?.trim()) {
      throw new BadRequestException('Indique el DNI del ganador');
    }
    const previa = await this.prisma.sorteoPremio.findFirst({
      where: {
        empresaId,
        ganadorDni: dni.trim(),
        estado: { not: EstadoPremioSorteo.ANULADO },
        modalidad: ModalidadEntregaPremio.ENVIO_AGENCIA,
        agenciaNombre: { not: null },
      },
      orderBy: { creadoEn: 'desc' },
      select: {
        modalidad: true,
        agenciaNombre: true,
        destinoDepartamento: true,
        destinoProvincia: true,
        agenciaDireccion: true,
        creadoEn: true,
      },
    });
    if (previa) return previa;

    // Sin premios previos: usar los datos de envío que dejó como
    // PARTICIPANTE en el bot de WhatsApp (si los dejó).
    const participante = await this.prisma.sorteoParticipante.findFirst({
      where: { empresaId, dni: dni.trim(), agenciaNombre: { not: null } },
      orderBy: { creadoEn: 'desc' },
      select: {
        agenciaNombre: true,
        destinoDepartamento: true,
        destinoProvincia: true,
        agenciaDireccion: true,
        creadoEn: true,
      },
    });
    if (!participante) return null;
    return {
      modalidad: ModalidadEntregaPremio.ENVIO_AGENCIA,
      ...participante,
    }; // null si nunca tuvo envío ni datos de participante
  }

  // ── Internos ─────────────────────────────────────────────────────────

  // ── Catálogo de premios (rifa con ánfora) ────────────────────────────

  async crearPremioCatalogo(
    empresaId: string,
    sorteoId: string,
    dto: { descripcion: string; cantidad?: number; esEfectivo?: boolean },
  ) {
    await this.assertSorteo(empresaId, sorteoId);
    const item = await this.prisma.sorteoPremioCatalogo.create({
      data: {
        empresaId,
        sorteoId,
        descripcion: dto.descripcion.trim().toUpperCase(),
        cantidad: dto.cantidad ?? 1,
        esEfectivo: dto.esEfectivo ?? false,
      },
    });
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId });
    return item;
  }

  async actualizarPremioCatalogo(
    empresaId: string,
    catalogoId: string,
    dto: { descripcion?: string; cantidad?: number; esEfectivo?: boolean },
  ) {
    const item = await this.prisma.sorteoPremioCatalogo.findFirst({
      where: { id: catalogoId, empresaId },
    });
    if (!item) throw new NotFoundException('Premio del catálogo no encontrado');
    const adjudicados = await this.prisma.sorteoPremio.count({
      where: { catalogoId, estado: { not: EstadoPremioSorteo.ANULADO } },
    });
    if (dto.cantidad != null && dto.cantidad < adjudicados) {
      throw new ConflictException(
        `Ya se sortearon ${adjudicados} unidades — la cantidad no puede ser menor`,
      );
    }
    const actualizado = await this.prisma.sorteoPremioCatalogo.update({
      where: { id: item.id },
      data: {
        ...(dto.descripcion?.trim() && {
          descripcion: dto.descripcion.trim().toUpperCase(),
        }),
        ...(dto.cantidad != null && { cantidad: dto.cantidad }),
        ...(dto.esEfectivo != null && { esEfectivo: dto.esEfectivo }),
      },
    });
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId: item.sorteoId });
    return actualizado;
  }

  async eliminarPremioCatalogo(empresaId: string, catalogoId: string) {
    const item = await this.prisma.sorteoPremioCatalogo.findFirst({
      where: { id: catalogoId, empresaId },
    });
    if (!item) throw new NotFoundException('Premio del catálogo no encontrado');
    const adjudicados = await this.prisma.sorteoPremio.count({
      where: { catalogoId, estado: { not: EstadoPremioSorteo.ANULADO } },
    });
    if (adjudicados > 0) {
      throw new ConflictException(
        'Ese premio ya se sorteó — no se puede eliminar',
      );
    }
    await this.prisma.sorteoPremioCatalogo.delete({ where: { id: item.id } });
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId: item.sorteoId });
    return { ok: true };
  }

  async subirImagenPremioCatalogo(
    empresaId: string,
    usuarioId: string,
    catalogoId: string,
    file: any,
  ) {
    const item = await this.prisma.sorteoPremioCatalogo.findFirst({
      where: { id: catalogoId, empresaId },
    });
    if (!item) throw new NotFoundException('Premio del catálogo no encontrado');
    const archivo = await this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: 'SORTEO_PREMIO_CATALOGO',
      entidadId: catalogoId,
      categoria: 'PRINCIPAL',
      subidoPor: usuarioId,
    });
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId: item.sorteoId });
    return archivo;
  }

  /**
   * MODO JUGAR (rifa con ánfora, SOLO con el sorteo CERRADO): salió el
   * ticket #N → se busca su dueño y se le adjudica un premio del
   * catálogo. El premio queda ligado a ESA participación (el ticket ya
   * "salió del ánfora": sus demás tickets siguen jugando) y hereda los
   * datos de envío del bot. montoParticipacion = 0 (la recaudación ya
   * está contada por la venta de tickets).
   */
  async jugarTicket(
    empresaId: string,
    usuarioId: string,
    sorteoId: string,
    dto: { numeroTicket: number; catalogoId: string },
  ) {
    const sorteo = await this.assertSorteo(empresaId, sorteoId);
    if (sorteo.tipo === TipoSorteo.DINAMICA) {
      throw new BadRequestException(
        'Las dinámicas no se juegan por ticket (cada jugador ya ganó)',
      );
    }
    if (sorteo.estado === EstadoSorteo.ABIERTO) {
      throw new ConflictException({
        code: 'SORTEO_ABIERTO',
        message: 'Cierra las ventas del sorteo antes de jugar',
      });
    }
    if (sorteo.estado === EstadoSorteo.FINALIZADO) {
      throw new ConflictException({
        code: 'SORTEO_FINALIZADO',
        message: 'El sorteo ya finalizó — no se puede seguir jugando',
      });
    }
    const catalogo = await this.prisma.sorteoPremioCatalogo.findFirst({
      where: { id: dto.catalogoId, sorteoId, empresaId },
    });
    if (!catalogo) {
      throw new NotFoundException('Premio del catálogo no encontrado');
    }
    const adjudicados = await this.prisma.sorteoPremio.count({
      where: {
        catalogoId: catalogo.id,
        estado: { not: EstadoPremioSorteo.ANULADO },
      },
    });
    if (adjudicados >= catalogo.cantidad) {
      throw new ConflictException({
        code: 'PREMIO_AGOTADO',
        message: `"${catalogo.descripcion}" ya se sorteó completo (${catalogo.cantidad})`,
      });
    }
    const ticket = await this.prisma.sorteoParticipante.findFirst({
      where: {
        sorteoId,
        empresaId,
        numeroTicket: dto.numeroTicket,
        estado: EstadoParticipanteSorteo.ACTIVO,
      },
    });
    if (!ticket) {
      throw new NotFoundException({
        code: 'TICKET_NO_EXISTE',
        message: `No hay ticket #${dto.numeroTicket} validado en este sorteo`,
      });
    }
    const yaPremiado = await this.prisma.sorteoPremio.findFirst({
      where: {
        participanteId: ticket.id,
        estado: { not: EstadoPremioSorteo.ANULADO },
      },
      select: { descripcion: true },
    });
    if (yaPremiado) {
      throw new ConflictException({
        code: 'TICKET_YA_PREMIADO',
        message:
          `El ticket #${dto.numeroTicket} ya ganó "${yaPremiado.descripcion}" ` +
          '— ese ticket ya salió del ánfora 🙈',
      });
    }

    // EFECTIVO 💸: sin datos de agencia — el bot le confirma al ganador
    // el número de Yape en vez de la dirección.
    const conAgencia = !catalogo.esEfectivo && !!ticket.agenciaNombre?.trim();
    const premio = await this.registrarPremio(
      empresaId,
      usuarioId,
      sorteoId,
      {
        participanteId: ticket.id,
        catalogoId: catalogo.id,
        esEfectivo: catalogo.esEfectivo,
        recibeNombre: ticket.recibeNombre ?? undefined,
        recibeDni: ticket.recibeDni ?? undefined,
        ganadorDni: ticket.dni,
        ganadorNombre: ticket.nombre,
        ganadorCelular: ticket.celular.slice(-9),
        descripcion: catalogo.descripcion,
        modalidad: conAgencia
          ? ModalidadEntregaPremio.ENVIO_AGENCIA
          : ModalidadEntregaPremio.RETIRO_TIENDA,
        agenciaNombre: conAgencia ? ticket.agenciaNombre! : undefined,
        destinoDepartamento: conAgencia
          ? (ticket.destinoDepartamento ?? undefined)
          : undefined,
        destinoProvincia: conAgencia
          ? (ticket.destinoProvincia ?? undefined)
          : undefined,
        agenciaDireccion: conAgencia
          ? (ticket.agenciaDireccion ?? undefined)
          : undefined,
        montoParticipacion: 0,
      } as RegistrarPremioDto,
      { permitirCerrado: true },
    );

    // Tickets del dueño que SIGUEN jugando (compró 10, ganó 1 → 9).
    const jugadas = await this.prisma.sorteoParticipante.findMany({
      where: {
        sorteoId,
        dni: ticket.dni,
        estado: EstadoParticipanteSorteo.ACTIVO,
      },
      select: { id: true },
    });
    const premiadas = await this.prisma.sorteoPremio.count({
      where: {
        participanteId: { in: jugadas.map((j) => j.id) },
        estado: { not: EstadoPremioSorteo.ANULADO },
      },
    });

    return {
      premio,
      ganadorNombre: ticket.nombre,
      ganadorDni: ticket.dni,
      numeroTicket: dto.numeroTicket,
      premioDescripcion: catalogo.descripcion,
      ticketsRestantes: jugadas.length - premiadas,
    };
  }

  // ── BINGO ────────────────────────────────────────────────────────────

  /** Cartilla 5×5 B-I-N-G-O (columnas 1-15/…/61-75, centro 0 = LIBRE). */
  private generarCartilla(): number[][] {
    const col = (min: number, max: number) => {
      const pool: number[] = [];
      for (let i = min; i <= max; i++) pool.push(i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, 5);
    };
    const cols = [
      col(1, 15),
      col(16, 30),
      col(31, 45),
      col(46, 60),
      col(61, 75),
    ];
    const grid: number[][] = [];
    for (let r = 0; r < 5; r++) {
      grid.push([cols[0][r], cols[1][r], cols[2][r], cols[3][r], cols[4][r]]);
    }
    grid[2][2] = 0; // centro LIBRE
    return grid;
  }

  /** Logros de una cartilla: LINEA (fila/columna/diagonal) y BINGO. */
  private logrosCartilla(
    cartilla: number[][],
    bolillas: number[],
  ): string[] {
    const marc = (r: number, c: number) =>
      cartilla[r][c] === 0 || bolillas.includes(cartilla[r][c]);
    const idx = [0, 1, 2, 3, 4];
    let linea = false;
    for (const i of idx) {
      if (idx.every((j) => marc(i, j)) || idx.every((j) => marc(j, i))) {
        linea = true;
        break;
      }
    }
    if (!linea && idx.every((i) => marc(i, i))) linea = true;
    if (!linea && idx.every((i) => marc(i, 4 - i))) linea = true;
    const bingo = idx.every((r) => idx.every((c) => marc(r, c)));
    const logros: string[] = [];
    if (linea || bingo) logros.push('LINEA');
    if (bingo) logros.push('BINGO');
    return logros;
  }

  /**
   * BINGO jugando (CERRADO): canta una bolilla — la registra, marca
   * TODAS las cartillas activas y devuelve los LOGROS NUEVOS (línea /
   * bingo) para que la empresa adjudique el premio del catálogo (modo
   * jugar con el número de la cartilla).
   */
  async registrarBolilla(
    empresaId: string,
    sorteoId: string,
    numero: number,
  ) {
    const sorteo = await this.assertSorteo(empresaId, sorteoId);
    if (sorteo.tipo !== TipoSorteo.BINGO) {
      throw new BadRequestException('Este sorteo no es un bingo');
    }
    if (sorteo.estado !== EstadoSorteo.CERRADO) {
      throw new ConflictException({
        code: 'BINGO_NO_JUGANDO',
        message:
          sorteo.estado === EstadoSorteo.ABIERTO
            ? 'Cierra las ventas del bingo antes de cantar bolillas'
            : 'El bingo ya finalizó',
      });
    }
    const bolillas: number[] = Array.isArray(sorteo.bolillas)
      ? [...(sorteo.bolillas as number[])]
      : [];
    if (bolillas.includes(numero)) {
      throw new ConflictException({
        code: 'BOLILLA_REPETIDA',
        message: `La bolilla ${numero} ya fue cantada`,
      });
    }
    bolillas.push(numero);
    await this.prisma.sorteo.update({
      where: { id: sorteoId },
      data: { bolillas },
    });

    const cartillas = await this.prisma.sorteoParticipante.findMany({
      where: { sorteoId, estado: EstadoParticipanteSorteo.ACTIVO },
    });
    const eventos: {
      participanteId: string;
      numeroCartilla: number | null;
      nombre: string;
      dni: string;
      logro: string;
    }[] = [];
    for (const p of cartillas) {
      if (!Array.isArray(p.cartilla)) continue;
      const previos: string[] = Array.isArray(p.bingoLogros)
        ? (p.bingoLogros as string[])
        : [];
      const actuales = this.logrosCartilla(
        p.cartilla as number[][],
        bolillas,
      );
      const nuevos = actuales.filter((l) => !previos.includes(l));
      if (nuevos.length === 0) continue;
      await this.prisma.sorteoParticipante.update({
        where: { id: p.id },
        data: { bingoLogros: actuales },
      });
      for (const logro of nuevos) {
        eventos.push({
          participanteId: p.id,
          numeroCartilla: p.numeroTicket,
          nombre: p.nombre,
          dni: p.dni,
          logro,
        });
      }
    }
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId });
    return { bolillas, eventos };
  }

  private async assertSorteo(empresaId: string, sorteoId: string) {
    const sorteo = await this.prisma.sorteo.findFirst({
      where: { id: sorteoId, empresaId },
    });
    if (!sorteo) throw new NotFoundException('Sorteo no encontrado');
    return sorteo;
  }

  private async assertPremio(empresaId: string, premioId: string) {
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: { id: premioId, empresaId },
    });
    if (!premio) throw new NotFoundException('Premio no encontrado');
    return premio;
  }

  /**
   * Adjunta los archivos del premio separados por rol: `tickets`
   * (EVIDENCIA = foto del ticket de agencia) y `fotos` (PRINCIPAL =
   * foto del premio ganado).
   */
  private async adjuntarArchivos<T extends { id: string }>(premios: T[]) {
    if (premios.length === 0) {
      return premios as (T & { tickets: any[]; fotos: any[] })[];
    }
    const archivos = await this.prisma.archivo.findMany({
      where: {
        entidadTipo: 'SORTEO_PREMIO',
        entidadId: { in: premios.map((p) => p.id) },
      },
      orderBy: { creadoEn: 'desc' },
      select: {
        id: true,
        entidadId: true,
        url: true,
        urlThumbnail: true,
        categoria: true,
        creadoEn: true,
      },
    });
    return premios.map((p) => ({
      ...p,
      tickets: archivos.filter(
        (a) => a.entidadId === p.id && a.categoria === 'EVIDENCIA',
      ),
      fotos: archivos.filter(
        (a) => a.entidadId === p.id && a.categoria === 'PRINCIPAL',
      ),
    }));
  }

  /** Vista del cliente: tickets/fotos + datos de la sede de retiro. */
  private async enriquecerPremiosCliente(premios: any[]) {
    const conTickets = await this.adjuntarArchivos(premios);
    const sedeIds = [
      ...new Set(
        conTickets
          .map((p: any) => p.sorteo?.sedeId)
          .filter((s: string | null): s is string => !!s),
      ),
    ];
    const sedes = sedeIds.length
      ? await this.prisma.sede.findMany({
          where: { id: { in: sedeIds } },
          select: {
            id: true,
            nombre: true,
            direccion: true,
            distrito: true,
            provincia: true,
            telefono: true,
          },
        })
      : [];
    const sedeMap = new Map(sedes.map((s) => [s.id, s]));
    return conTickets.map((p: any) => ({
      ...p,
      sedeRetiro:
        p.modalidad === 'RETIRO_TIENDA' && p.sorteo?.sedeId
          ? (sedeMap.get(p.sorteo.sedeId) ?? null)
          : null,
    }));
  }

  /** Push FCM al ganador con nombre de empresa — best-effort. */
  private notificarGanador(
    premioId: string,
    empresaId: string,
    ganadorId: string,
    opts: { titulo: string; cuerpoBase: string; action: string },
  ) {
    void (async () => {
      try {
        const empresa = await this.prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { nombre: true },
        });
        await this.notificaciones.enviarAUsuario(
          ganadorId,
          opts.titulo,
          `${empresa?.nombre ?? 'Una empresa'}: ${opts.cuerpoBase}`,
          {
            tipo: TipoNotificacion.SORTEO,
            // 'tipo' explícito en data: el deep-link del app rutea por
            // message.data['tipo'] → /mis-premios/:id.
            data: { tipo: 'SORTEO', premioId, action: opts.action },
            empresaId,
          },
        );
      } catch (e) {
        this.logger.warn(
          `FCM al ganador ${ganadorId} falló (premio ${premioId}): ${e}`,
        );
      }
    })();
  }
}
