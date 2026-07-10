import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoPremioSorteo,
  EstadoSorteo,
  Prisma,
  TipoMovimientoStock,
  TipoNotificacion,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { StorageService } from '../storage/storage.service';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';
import {
  CambiarEstadoPremioDto,
  CreateSorteoDto,
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
    private readonly storage: StorageService,
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
        fechaSorteo: dto.fechaSorteo ? new Date(dto.fechaSorteo) : undefined,
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
      include: { premios: { orderBy: { creadoEn: 'desc' } } },
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

    return {
      ...sorteo,
      premios,
      imagenes,
      resumen: {
        totalRecaudado,
        costoPremios,
        ganancia: totalRecaudado - costoPremios,
      },
    };
  }

  async actualizarSorteo(
    empresaId: string,
    sorteoId: string,
    dto: UpdateSorteoDto,
  ) {
    await this.assertSorteo(empresaId, sorteoId);
    return this.prisma.sorteo.update({
      where: { id: sorteoId },
      data: {
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        canal: dto.canal,
        estado: dto.estado,
        sedeId: dto.sedeId,
        fechaSorteo: dto.fechaSorteo ? new Date(dto.fechaSorteo) : undefined,
        precioParticipacion: dto.precioParticipacion,
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
  ) {
    const sorteo = await this.assertSorteo(empresaId, sorteoId);
    if (sorteo.estado === EstadoSorteo.CERRADO) {
      throw new ConflictException({
        code: 'SORTEO_CERRADO',
        message: 'El sorteo está cerrado — reábrelo para registrar premios',
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
        throw new NotFoundException({
          code: 'GANADOR_SIN_CUENTA',
          message:
            'El DNI no tiene cuenta en el app — registra primero al ' +
            'ganador como cliente',
        });
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

    if (dto.estado === EstadoPremioSorteo.ENVIADO) {
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
    await this.assertPremio(empresaId, premioId);
    return this.storage.uploadArchivo({
      empresaId,
      file,
      entidadTipo: 'SORTEO_PREMIO',
      entidadId: premioId,
      categoria: 'EVIDENCIA',
      subidoPor: usuarioId,
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

  // ── Internos ─────────────────────────────────────────────────────────

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
