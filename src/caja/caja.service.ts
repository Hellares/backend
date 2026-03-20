import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EstadoCaja,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
  Prisma,
} from '@prisma/client';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';

@Injectable()
export class CajaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abrir una nueva caja
   */
  async abrirCaja(empresaId: string, usuarioId: string, dto: AbrirCajaDto) {
    // Verificar que no tenga una caja abierta en la misma sede
    const cajaExistente = await this.prisma.caja.findFirst({
      where: {
        empresaId,
        usuarioId,
        sedeId: dto.sedeId,
        estado: EstadoCaja.ABIERTA,
      },
    });

    if (cajaExistente) {
      throw new BadRequestException(
        'Ya tienes una caja abierta en esta sede. Ciérrala antes de abrir otra.',
      );
    }

    // Generar código
    const codigo = await this.prisma.$transaction(async (tx) => {
      return this._generarCodigoCaja(tx, empresaId);
    });

    // Crear caja
    const caja = await this.prisma.caja.create({
      data: {
        empresaId,
        sedeId: dto.sedeId,
        usuarioId,
        codigo,
        montoApertura: dto.montoApertura,
        estado: EstadoCaja.ABIERTA,
        observacionesApertura: dto.observaciones,
      },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return caja;
  }

  /**
   * Obtener caja activa del usuario
   */
  async getCajaActiva(empresaId: string, usuarioId: string) {
    const caja = await this.prisma.caja.findFirst({
      where: {
        empresaId,
        usuarioId,
        estado: EstadoCaja.ABIERTA,
      },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        _count: {
          select: { movimientos: true },
        },
      },
    });

    if (!caja) {
      return null;
    }

    // Calcular totales rápidos
    const totales = await this.prisma.movimientoCaja.groupBy({
      by: ['tipo'],
      where: { cajaId: caja.id },
      _sum: { monto: true },
    });

    const totalIngresos = Number(
      totales.find((t) => t.tipo === TipoMovimientoCaja.INGRESO)?._sum.monto ?? 0,
    );
    const totalEgresos = Number(
      totales.find((t) => t.tipo === TipoMovimientoCaja.EGRESO)?._sum.monto ?? 0,
    );

    return {
      ...caja,
      totalIngresos,
      totalEgresos,
      saldoActual: Number(caja.montoApertura) + totalIngresos - totalEgresos,
    };
  }

  /**
   * Crear movimiento manual en la caja
   */
  async crearMovimiento(
    empresaId: string,
    cajaId: string,
    usuarioId: string,
    dto: CrearMovimientoDto,
  ) {
    // Verificar que la caja exista y esté abierta
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId, estado: EstadoCaja.ABIERTA },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada o no está abierta');
    }

    const movimiento = await this.prisma.movimientoCaja.create({
      data: {
        cajaId,
        empresaId,
        tipo: dto.tipo,
        categoria: dto.categoria,
        metodoPago: dto.metodoPago,
        monto: dto.monto,
        descripcion: dto.descripcion,
        esManual: true,
        registradoPorId: usuarioId,
      },
    });

    return movimiento;
  }

  /**
   * Crear movimiento automático (llamado desde otros módulos)
   */
  async crearMovimientoAutomatico(
    empresaId: string,
    cajaId: string,
    data: {
      tipo: TipoMovimientoCaja;
      categoria: CategoriaMovimientoCaja;
      metodoPago: MetodoPagoVenta;
      monto: number;
      descripcion?: string;
      ventaId?: string;
      pedidoMarketplaceId?: string;
      compraId?: string;
      devolucionId?: string;
      registradoPorId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    const movimiento = await client.movimientoCaja.create({
      data: {
        cajaId,
        empresaId,
        tipo: data.tipo,
        categoria: data.categoria,
        metodoPago: data.metodoPago,
        monto: data.monto,
        descripcion: data.descripcion,
        ventaId: data.ventaId,
        pedidoMarketplaceId: data.pedidoMarketplaceId,
        compraId: data.compraId,
        devolucionId: data.devolucionId,
        esManual: false,
        registradoPorId: data.registradoPorId,
      },
    });

    return movimiento;
  }

  /**
   * Registrar movimiento automático buscando la caja activa del usuario en la sede.
   * Si no hay caja activa, no hace nada (no bloquea la operación).
   */
  async registrarMovimientoSiHayCaja(
    empresaId: string,
    sedeId: string,
    usuarioId: string,
    data: {
      tipo: TipoMovimientoCaja;
      categoria: CategoriaMovimientoCaja;
      metodoPago: MetodoPagoVenta;
      monto: number;
      descripcion?: string;
      ventaId?: string;
      pedidoMarketplaceId?: string;
      compraId?: string;
      devolucionId?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    // Buscar primero la caja del usuario específico, luego cualquier caja de la sede
    const cajaActiva = await client.caja.findFirst({
      where: { empresaId, sedeId, usuarioId, estado: EstadoCaja.ABIERTA },
    }) ?? await client.caja.findFirst({
      where: { empresaId, sedeId, estado: EstadoCaja.ABIERTA },
    });

    if (!cajaActiva) return;

    await this.crearMovimientoAutomatico(empresaId, cajaActiva.id, {
      ...data,
      registradoPorId: usuarioId,
    }, tx);
  }

  /**
   * Listar movimientos de una caja
   */
  async getMovimientos(empresaId: string, cajaId: string) {
    // Verificar que la caja exista
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: { cajaId },
      orderBy: { fechaMovimiento: 'desc' },
      include: {
        venta: { select: { id: true, codigo: true } },
        pedidoMarketplace: { select: { id: true, codigo: true } },
        compra: { select: { id: true, codigo: true } },
        devolucion: { select: { id: true, codigo: true } },
        registradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return movimientos;
  }

  /**
   * Cerrar caja
   */
  async cerrarCaja(
    empresaId: string,
    cajaId: string,
    usuarioId: string,
    dto: CerrarCajaDto,
  ) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId, estado: EstadoCaja.ABIERTA },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada o no está abierta');
    }

    // Calcular totales por método de pago y tipo
    const movimientos = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId },
      _sum: { monto: true },
    });

    // Construir detalle por método de pago
    const metodosPago = Object.values(MetodoPagoVenta);
    const detallePorMetodoPago: Record<
      string,
      { ingresos: number; egresos: number; esperado: number; conteoFisico: number; diferencia: number }
    > = {};

    let totalIngresos = 0;
    let totalEgresos = 0;

    for (const metodo of metodosPago) {
      const ingresos = Number(
        movimientos.find(
          (m) => m.metodoPago === metodo && m.tipo === TipoMovimientoCaja.INGRESO,
        )?._sum.monto ?? 0,
      );
      const egresos = Number(
        movimientos.find(
          (m) => m.metodoPago === metodo && m.tipo === TipoMovimientoCaja.EGRESO,
        )?._sum.monto ?? 0,
      );

      totalIngresos += ingresos;
      totalEgresos += egresos;

      const esperado = ingresos - egresos;
      const conteo = dto.conteos.find((c) => c.metodoPago === metodo);
      const conteoFisico = conteo?.conteoFisico ?? 0;

      detallePorMetodoPago[metodo] = {
        ingresos,
        egresos,
        esperado,
        conteoFisico,
        diferencia: conteoFisico - esperado,
      };
    }

    // Incluir monto de apertura en el total esperado (siempre es efectivo)
    const montoApertura = Number(caja.montoApertura);
    const totalEsperado = montoApertura + totalIngresos - totalEgresos;
    const totalConteoFisico = dto.conteos.reduce(
      (sum, c) => sum + c.conteoFisico,
      0,
    );
    const diferencia = totalConteoFisico - totalEsperado;

    // Crear cierre y actualizar caja en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const cierre = await tx.cierreCaja.create({
        data: {
          cajaId,
          totalIngresos,
          totalEgresos,
          totalEsperado,
          totalConteoFisico,
          diferencia,
          detallePorMetodoPago,
          observaciones: dto.observaciones,
        },
      });

      const cajaActualizada = await tx.caja.update({
        where: { id: cajaId },
        data: {
          estado: EstadoCaja.CERRADA,
          fechaCierre: new Date(),
          cerradoPorId: usuarioId,
          observacionesCierre: dto.observaciones,
        },
        include: {
          sede: { select: { id: true, nombre: true, codigo: true } },
          usuario: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      return { caja: cajaActualizada, cierre };
    });

    return result;
  }

  /**
   * Obtener resumen de una caja (agrupado por metodoPago + tipo)
   */
  async getResumen(empresaId: string, cajaId: string) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cierre: true,
      },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    const resumenPorMetodo = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId },
      _sum: { monto: true },
      _count: { id: true },
    });

    const resumenPorCategoria = await this.prisma.movimientoCaja.groupBy({
      by: ['categoria', 'tipo'],
      where: { cajaId },
      _sum: { monto: true },
      _count: { id: true },
    });

    // Totales generales
    const totalIngresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.INGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const totalEgresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.EGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    return {
      caja,
      montoApertura: Number(caja.montoApertura),
      totalIngresos,
      totalEgresos,
      saldoActual: Number(caja.montoApertura) + totalIngresos - totalEgresos,
      resumenPorMetodo,
      resumenPorCategoria,
    };
  }

  /**
   * Historial de cajas cerradas
   */
  async getHistorial(
    empresaId: string,
    sedeId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const where: Prisma.CajaWhereInput = {
      empresaId,
      estado: EstadoCaja.CERRADA,
    };

    if (sedeId) {
      where.sedeId = sedeId;
    }

    if (fechaDesde || fechaHasta) {
      where.fechaApertura = {};
      if (fechaDesde) {
        where.fechaApertura.gte = new Date(fechaDesde);
      }
      if (fechaHasta) {
        where.fechaApertura.lte = new Date(fechaHasta);
      }
    }

    const cajas = await this.prisma.caja.findMany({
      where,
      orderBy: { fechaCierre: 'desc' },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cerradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cierre: {
          select: {
            totalIngresos: true,
            totalEgresos: true,
            totalEsperado: true,
            totalConteoFisico: true,
            diferencia: true,
          },
        },
      },
    });

    return cajas;
  }

  // ─── Configuración ───

  async getConfiguracion(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { requiereCajaParaVender: true },
    });
    return { requiereCajaParaVender: empresa?.requiereCajaParaVender ?? false };
  }

  async updateConfiguracion(empresaId: string, requiereCajaParaVender: boolean) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { requiereCajaParaVender },
    });
    return this.getConfiguracion(empresaId);
  }

  // ─── Helper: generar código de caja ───

  private async _generarCodigoCaja(
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
        ultimaCaja: { increment: 1 },
      },
    });

    const numero = updated.ultimaCaja
      .toString()
      .padStart(config.cajaLongitud, '0');

    return `${config.cajaCodigo}${config.cajaSeparador}${numero}`;
  }
}
