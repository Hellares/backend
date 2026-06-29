import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import {
  EstadoCajaChica,
  EstadoRendicion,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
  Prisma,
} from '@prisma/client';
import { CrearCajaChicaDto } from './dto/crear-caja-chica.dto';
import { CrearGastoCajaChicaDto } from './dto/crear-gasto-caja-chica.dto';
import { CrearRendicionDto } from './dto/crear-rendicion.dto';

@Injectable()
export class CajaChicaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
  ) {}

  // --- CAJA CHICA CRUD ---

  async crearCajaChica(
    empresaId: string,
    dto: CrearCajaChicaDto,
    usuarioId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cajaChica = await tx.cajaChica.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          nombre: dto.nombre,
          fondoFijo: dto.fondoFijo,
          saldoActual: dto.fondoFijo,
          umbralAlerta: dto.umbralAlerta ?? 0,
          responsableId: dto.responsableId,
        },
        include: {
          sede: { select: { id: true, nombre: true } },
          responsable: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      // Fondear: el fondo inicial SALE de la Caja Central (bóveda/Tesorería)
      // como EGRESO, para que el dinero tenga origen real y quede trazado en
      // tesorería (el float se devuelve a la bóveda al desactivar la caja chica).
      if (Number(dto.fondoFijo) > 0) {
        const central = await this.cajaService.getOrCreateCajaCentral(
          empresaId,
          dto.sedeId,
          tx,
        );
        await this.cajaService.crearMovimientoAutomatico(
          empresaId,
          central.id,
          {
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.REPOSICION_CAJA_CHICA,
            metodoPago: MetodoPagoVenta.EFECTIVO,
            monto: Number(dto.fondoFijo),
            descripcion: `Apertura caja chica: ${dto.nombre} (fondo inicial)`,
            registradoPorId: usuarioId,
          },
          tx,
        );
      }

      return cajaChica;
    });
  }

  async listarCajasChicas(empresaId: string, sedeId?: string) {
    const where: any = { empresaId };
    if (sedeId) where.sedeId = sedeId;

    return this.prisma.cajaChica.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      include: {
        sede: { select: { id: true, nombre: true } },
        responsable: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });
  }

  async getCajaChica(empresaId: string, id: string) {
    const cajaChica = await this.prisma.cajaChica.findFirst({
      where: { id, empresaId },
      include: {
        sede: { select: { id: true, nombre: true } },
        responsable: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    if (!cajaChica) {
      throw new NotFoundException('Caja chica no encontrada');
    }

    return cajaChica;
  }

  async actualizarEstado(
    empresaId: string,
    id: string,
    estado: EstadoCajaChica,
    usuarioId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cajaChica = await tx.cajaChica.findFirst({
        where: { id, empresaId },
      });
      if (!cajaChica) throw new NotFoundException('Caja chica no encontrada');

      let nuevoSaldo: Prisma.Decimal | number = cajaChica.saldoActual;

      // ACTIVA → INACTIVA: el efectivo restante VUELVE a la bóveda (INGRESO) y
      // la caja chica queda en 0 (se devolvió físicamente el dinero).
      if (
        cajaChica.estado === 'ACTIVA' &&
        estado === 'INACTIVA' &&
        Number(cajaChica.saldoActual) > 0
      ) {
        const central = await this.cajaService.getOrCreateCajaCentral(
          empresaId,
          cajaChica.sedeId,
          tx,
        );
        await this.cajaService.crearMovimientoAutomatico(
          empresaId,
          central.id,
          {
            tipo: TipoMovimientoCaja.INGRESO,
            categoria: CategoriaMovimientoCaja.REPOSICION_CAJA_CHICA,
            metodoPago: MetodoPagoVenta.EFECTIVO,
            monto: Number(cajaChica.saldoActual),
            descripcion: `Cierre caja chica: ${cajaChica.nombre} (devolución de saldo)`,
            registradoPorId: usuarioId,
          },
          tx,
        );
        nuevoSaldo = 0;
      }

      // INACTIVA → ACTIVA: re-fondear el fondo fijo desde la bóveda (EGRESO).
      if (
        cajaChica.estado === 'INACTIVA' &&
        estado === 'ACTIVA' &&
        Number(cajaChica.fondoFijo) > 0
      ) {
        const central = await this.cajaService.getOrCreateCajaCentral(
          empresaId,
          cajaChica.sedeId,
          tx,
        );
        await this.cajaService.crearMovimientoAutomatico(
          empresaId,
          central.id,
          {
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.REPOSICION_CAJA_CHICA,
            metodoPago: MetodoPagoVenta.EFECTIVO,
            monto: Number(cajaChica.fondoFijo),
            descripcion: `Reapertura caja chica: ${cajaChica.nombre} (fondo inicial)`,
            registradoPorId: usuarioId,
          },
          tx,
        );
        nuevoSaldo = cajaChica.fondoFijo;
      }

      return tx.cajaChica.update({
        where: { id },
        data: { estado, saldoActual: nuevoSaldo },
      });
    });
  }

  // --- GASTOS ---

  async registrarGasto(
    empresaId: string,
    cajaChicaId: string,
    usuarioId: string,
    dto: CrearGastoCajaChicaDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cajaChica = await tx.cajaChica.findFirst({
        where: { id: cajaChicaId, empresaId, estado: 'ACTIVA' },
      });

      if (!cajaChica) {
        throw new NotFoundException('Caja chica no encontrada o no está activa');
      }

      if (Number(cajaChica.saldoActual) < dto.monto) {
        throw new BadRequestException(
          `Saldo insuficiente. Saldo actual: S/ ${Number(cajaChica.saldoActual).toFixed(2)}, Gasto: S/ ${dto.monto.toFixed(2)}`,
        );
      }

      // Crear gasto
      const gasto = await tx.gastoCajaChica.create({
        data: {
          cajaChicaId,
          empresaId,
          monto: dto.monto,
          descripcion: dto.descripcion,
          categoriaGastoId: dto.categoriaGastoId,
          comprobanteUrl: dto.comprobanteUrl,
          registradoPorId: usuarioId,
        },
        include: {
          categoriaGasto: { select: { id: true, nombre: true, tipo: true, icono: true, color: true } },
        },
      });

      // Decrementar saldo
      await tx.cajaChica.update({
        where: { id: cajaChicaId },
        data: {
          saldoActual: { decrement: dto.monto },
        },
      });

      return gasto;
    });
  }

  async listarGastos(empresaId: string, cajaChicaId: string, pendientes?: boolean) {
    const where: any = { cajaChicaId, empresaId };
    if (pendientes) {
      where.rendicionId = null;
    }

    return this.prisma.gastoCajaChica.findMany({
      where,
      orderBy: { fechaGasto: 'desc' },
      include: {
        categoriaGasto: { select: { id: true, nombre: true, tipo: true, icono: true, color: true } },
        registradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });
  }

  // --- RENDICIONES ---

  async crearRendicion(
    empresaId: string,
    cajaChicaId: string,
    dto: CrearRendicionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cajaChica = await tx.cajaChica.findFirst({
        where: { id: cajaChicaId, empresaId },
      });
      if (!cajaChica) throw new NotFoundException('Caja chica no encontrada');

      // Verificar que los gastos existen, pertenecen a esta caja y no tienen rendición
      const gastos = await tx.gastoCajaChica.findMany({
        where: {
          id: { in: dto.gastoIds },
          cajaChicaId,
          rendicionId: null,
        },
      });

      if (gastos.length !== dto.gastoIds.length) {
        throw new BadRequestException(
          'Algunos gastos no existen, no pertenecen a esta caja chica o ya tienen rendición',
        );
      }

      const totalGastado = gastos.reduce((sum, g) => sum + Number(g.monto), 0);

      // Generar código
      const codigo = await this._generarCodigoRendicion(tx, empresaId);

      // Crear rendición
      const rendicion = await tx.rendicionCajaChica.create({
        data: {
          cajaChicaId,
          empresaId,
          codigo,
          totalGastado,
          observaciones: dto.observaciones,
        },
      });

      // Vincular gastos a la rendición
      await tx.gastoCajaChica.updateMany({
        where: { id: { in: dto.gastoIds } },
        data: { rendicionId: rendicion.id },
      });

      return rendicion;
    });
  }

  async listarRendiciones(empresaId: string, cajaChicaId?: string, estado?: string) {
    const where: any = { empresaId };
    if (cajaChicaId) where.cajaChicaId = cajaChicaId;
    if (estado) where.estado = estado;

    return this.prisma.rendicionCajaChica.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      include: {
        cajaChica: { select: { id: true, nombre: true, sedeId: true } },
        gastos: {
          include: {
            categoriaGasto: { select: { id: true, nombre: true, icono: true, color: true } },
          },
        },
        aprobadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });
  }

  async getRendicion(empresaId: string, rendicionId: string) {
    const rendicion = await this.prisma.rendicionCajaChica.findFirst({
      where: { id: rendicionId, empresaId },
      include: {
        cajaChica: {
          select: { id: true, nombre: true, sedeId: true, sede: { select: { nombre: true } } },
        },
        gastos: {
          include: {
            categoriaGasto: { select: { id: true, nombre: true, tipo: true, icono: true, color: true } },
            registradoPor: {
              select: {
                id: true,
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        },
        aprobadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    if (!rendicion) throw new NotFoundException('Rendición no encontrada');
    return rendicion;
  }

  async aprobarRendicion(
    empresaId: string,
    rendicionId: string,
    usuarioId: string,
    observaciones?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rendicion = await tx.rendicionCajaChica.findFirst({
        where: { id: rendicionId, empresaId, estado: 'PENDIENTE' },
        include: { cajaChica: true },
      });

      if (!rendicion) {
        throw new NotFoundException('Rendición no encontrada o no está pendiente');
      }

      // Reposición desde la Caja Central (bóveda/Tesorería) de la sede, que
      // SIEMPRE existe (se auto-crea). Antes se buscaba una caja POS abierta
      // arbitraria y, si no había ninguna, se reponía el saldo SIN registrar el
      // egreso → hueco contable (efectivo que aparece sin origen). La caja chica
      // se repone del fondo central, no de una caja de venta cualquiera.
      const central = await this.cajaService.getOrCreateCajaCentral(
        empresaId,
        rendicion.cajaChica.sedeId,
        tx,
      );

      const movimiento = await this.cajaService.crearMovimientoAutomatico(
        empresaId,
        central.id,
        {
          tipo: TipoMovimientoCaja.EGRESO,
          categoria: CategoriaMovimientoCaja.REPOSICION_CAJA_CHICA,
          metodoPago: MetodoPagoVenta.EFECTIVO,
          monto: Number(rendicion.totalGastado),
          descripcion: `Reposición caja chica: ${rendicion.cajaChica.nombre} - Rendición ${rendicion.codigo}`,
          registradoPorId: usuarioId,
        },
        tx,
      );

      // Aprobar rendición (siempre con su movimiento de reposición vinculado)
      const rendicionAprobada = await tx.rendicionCajaChica.update({
        where: { id: rendicionId },
        data: {
          estado: 'APROBADA',
          aprobadoPorId: usuarioId,
          observaciones: observaciones ?? rendicion.observaciones,
          movimientoCajaId: movimiento.id,
        },
      });

      // Reponer SOLO lo rendido (incrementa por totalGastado), NO resetear a
      // fondoFijo: una rendición puede cubrir solo parte de los gastos
      // pendientes, así que un reset total sobre-repondría los gastos aún no
      // rendidos.
      await tx.cajaChica.update({
        where: { id: rendicion.cajaChicaId },
        data: {
          saldoActual: { increment: Number(rendicion.totalGastado) },
        },
      });

      return rendicionAprobada;
    });
  }

  async rechazarRendicion(
    empresaId: string,
    rendicionId: string,
    usuarioId: string,
    observaciones: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rendicion = await tx.rendicionCajaChica.findFirst({
        where: { id: rendicionId, empresaId, estado: 'PENDIENTE' },
      });

      if (!rendicion) {
        throw new NotFoundException('Rendición no encontrada o no está pendiente');
      }

      // Rechazar rendición
      const rendicionRechazada = await tx.rendicionCajaChica.update({
        where: { id: rendicionId },
        data: {
          estado: 'RECHAZADA',
          aprobadoPorId: usuarioId,
          observaciones,
        },
      });

      // Liberar gastos de esta rendición (para que puedan ser incluidos en una nueva)
      await tx.gastoCajaChica.updateMany({
        where: { rendicionId },
        data: { rendicionId: null },
      });

      return rendicionRechazada;
    });
  }

  // --- Helper ---

  private async _generarCodigoRendicion(
    tx: Prisma.TransactionClient,
    empresaId: string,
  ): Promise<string> {
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimaRendicion: { increment: 1 },
      },
    });

    const numero = updated.ultimaRendicion
      .toString()
      .padStart(config.rendicionLongitud, '0');

    return `${config.rendicionCodigo}${config.rendicionSeparador}${numero}`;
  }
}
