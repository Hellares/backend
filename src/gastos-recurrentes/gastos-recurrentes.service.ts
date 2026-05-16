import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CategoriaArchivo,
  CategoriaMovimientoCaja,
  EntidadTipo,
  EstadoCaja,
  FuentePagoGasto,
  MetodoPagoVenta,
  Prisma,
  TipoCategoriaGasto,
  TipoMovimientoCaja,
} from '@prisma/client';
import { CrearGastoRecurrenteDto } from './dto/crear-gasto-recurrente.dto';
import { ActualizarGastoRecurrenteDto } from './dto/actualizar-gasto-recurrente.dto';
import { ListarGastosRecurrentesQueryDto } from './dto/listar-gastos-recurrentes.query.dto';
import { PagarGastoRecurrenteDto } from './dto/pagar-gasto-recurrente.dto';
import { StorageService } from '../storage/storage.service';

export type EstadoPeriodoGasto = 'PAGADO' | 'PENDIENTE' | 'VENCIDO';

@Injectable()
export class GastosRecurrentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Sube el comprobante (foto del recibo) a S3 vía StorageService.
   * Permiso del módulo (no de settings global). Categoría 'comprobante'.
   * Devuelve URL pública para asociar al PagoGastoRecurrente en /pagar.
   */
  async uploadComprobante(empresaId: string, usuarioId: string, file: any) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    const archivo = await this.storageService.uploadArchivo({
      empresaId,
      file,
      entidadTipo: EntidadTipo.PAGO_GASTO_RECURRENTE,
      categoria: CategoriaArchivo.EVIDENCIA,
      subidoPor: usuarioId,
    });
    return {
      archivoId: archivo.id,
      url: archivo.url,
      tipoArchivo: archivo.tipoArchivo,
      tamanoBytes: archivo.tamanoBytes,
    };
  }

  private readonly defaultInclude = {
    categoriaGasto: {
      select: { id: true, nombre: true, icono: true, color: true },
    },
    sede: { select: { id: true, nombre: true } },
    proveedor: { select: { id: true, nombre: true, numeroDocumento: true } },
  } as const;

  async crear(empresaId: string, dto: CrearGastoRecurrenteDto) {
    await this.assertCategoriaEgreso(empresaId, dto.categoriaGastoId);
    if (dto.sedeId) await this.assertSedePertenece(empresaId, dto.sedeId);
    if (dto.proveedorId) await this.assertProveedorPertenece(empresaId, dto.proveedorId);

    return this.prisma.gastoRecurrente.create({
      data: {
        empresaId,
        sedeId: dto.sedeId ?? null,
        nombre: dto.nombre.trim(),
        categoriaGastoId: dto.categoriaGastoId,
        proveedorId: dto.proveedorId ?? null,
        montoEstimado: dto.montoEstimado,
        frecuencia: dto.frecuencia,
        diaVencimiento: dto.diaVencimiento,
        notas: dto.notas?.trim() || null,
      },
      include: this.defaultInclude,
    });
  }

  async listar(empresaId: string, query: ListarGastosRecurrentesQueryDto) {
    const where: any = { empresaId };
    if (query.sedeId === 'null') where.sedeId = null;
    else if (query.sedeId) where.sedeId = query.sedeId;
    if (query.categoriaGastoId) where.categoriaGastoId = query.categoriaGastoId;
    if (query.proveedorId) where.proveedorId = query.proveedorId;
    if (query.frecuencia) where.frecuencia = query.frecuencia;
    if (query.activo === 'true') where.activo = true;
    if (query.activo === 'false') where.activo = false;

    return this.prisma.gastoRecurrente.findMany({
      where,
      orderBy: [{ activo: 'desc' }, { diaVencimiento: 'asc' }, { nombre: 'asc' }],
      include: this.defaultInclude,
    });
  }

  async obtener(empresaId: string, id: string) {
    const gasto = await this.prisma.gastoRecurrente.findFirst({
      where: { id, empresaId },
      include: {
        ...this.defaultInclude,
        pagos: {
          orderBy: { fechaPago: 'desc' },
          take: 12,
          select: {
            id: true,
            periodo: true,
            montoReal: true,
            fechaPago: true,
            fuente: true,
            metodoPago: true,
            comprobanteUrl: true,
          },
        },
      },
    });
    if (!gasto) throw new NotFoundException('Gasto recurrente no encontrado');
    return gasto;
  }

  async actualizar(empresaId: string, id: string, dto: ActualizarGastoRecurrenteDto) {
    const actual = await this.prisma.gastoRecurrente.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!actual) throw new NotFoundException('Gasto recurrente no encontrado');

    if (dto.categoriaGastoId) {
      await this.assertCategoriaEgreso(empresaId, dto.categoriaGastoId);
    }
    if (dto.sedeId) await this.assertSedePertenece(empresaId, dto.sedeId);
    if (dto.proveedorId) await this.assertProveedorPertenece(empresaId, dto.proveedorId);

    const data: any = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.categoriaGastoId !== undefined) data.categoriaGastoId = dto.categoriaGastoId;
    if (dto.sedeId !== undefined) data.sedeId = dto.sedeId; // null limpia
    if (dto.proveedorId !== undefined) data.proveedorId = dto.proveedorId;
    if (dto.montoEstimado !== undefined) data.montoEstimado = dto.montoEstimado;
    if (dto.frecuencia !== undefined) data.frecuencia = dto.frecuencia;
    if (dto.diaVencimiento !== undefined) data.diaVencimiento = dto.diaVencimiento;
    if (dto.activo !== undefined) data.activo = dto.activo;
    if (dto.notas !== undefined) data.notas = dto.notas?.trim() || null;

    return this.prisma.gastoRecurrente.update({
      where: { id },
      data,
      include: this.defaultInclude,
    });
  }

  async toggleActivo(empresaId: string, id: string) {
    const gasto = await this.prisma.gastoRecurrente.findFirst({
      where: { id, empresaId },
      select: { id: true, activo: true },
    });
    if (!gasto) throw new NotFoundException('Gasto recurrente no encontrado');

    return this.prisma.gastoRecurrente.update({
      where: { id },
      data: { activo: !gasto.activo },
      include: this.defaultInclude,
    });
  }

  async eliminar(empresaId: string, id: string) {
    const gasto = await this.prisma.gastoRecurrente.findFirst({
      where: { id, empresaId },
      select: { id: true, _count: { select: { pagos: true } } },
    });
    if (!gasto) throw new NotFoundException('Gasto recurrente no encontrado');

    if (gasto._count.pagos > 0) {
      throw new ConflictException(
        'No se puede eliminar: tiene historial de pagos. Desactívalo en su lugar.',
      );
    }

    await this.prisma.gastoRecurrente.delete({ where: { id } });
    return { id, eliminado: true };
  }

  // ===========================================
  //  PAGAR — núcleo híbrido CAJA/BANCO
  // ===========================================

  async pagar(
    empresaId: string,
    gastoId: string,
    usuarioId: string,
    dto: PagarGastoRecurrenteDto,
  ) {
    const gasto = await this.prisma.gastoRecurrente.findFirst({
      where: { id: gastoId, empresaId },
      select: {
        id: true,
        nombre: true,
        activo: true,
        categoriaGastoId: true,
        sedeId: true,
      },
    });
    if (!gasto) throw new NotFoundException('Gasto recurrente no encontrado');
    if (!gasto.activo) {
      throw new BadRequestException('Gasto recurrente inactivo — actívalo para registrar pagos');
    }

    // CREDITO y MIXTO no aplican a un egreso atómico: CREDITO es "debo y luego
    // pago" (no ocurre cuando ya estás registrando el pago efectivo) y MIXTO es
    // etiqueta UX para ventas con >1 PagoVenta — aquí siempre hay 1 solo pago.
    if (
      dto.metodoPago === MetodoPagoVenta.CREDITO ||
      dto.metodoPago === MetodoPagoVenta.MIXTO
    ) {
      throw new BadRequestException(
        `Método de pago ${dto.metodoPago} no es válido para gastos recurrentes`,
      );
    }

    if (dto.fuente === FuentePagoGasto.BANCO && dto.metodoPago === MetodoPagoVenta.EFECTIVO) {
      throw new BadRequestException(
        'EFECTIVO no es compatible con fuente=BANCO. Usa fuente=CAJA o cambia el método de pago.',
      );
    }

    // Validación previa de caja/banco fuera de la transacción
    if (dto.fuente === FuentePagoGasto.CAJA) {
      const caja = await this.prisma.caja.findFirst({
        where: { id: dto.cajaId!, empresaId, estado: EstadoCaja.ABIERTA },
        select: { id: true },
      });
      if (!caja) {
        throw new BadRequestException('Caja no encontrada o no está abierta');
      }
    } else {
      const banco = await this.prisma.empresaBanco.findFirst({
        where: { id: dto.bancoId!, empresaId, isActive: true },
        select: { id: true },
      });
      if (!banco) {
        throw new BadRequestException('Cuenta bancaria no encontrada o inactiva');
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let movimientoCajaId: string | null = null;

        if (dto.fuente === FuentePagoGasto.CAJA) {
          const movimiento = await tx.movimientoCaja.create({
            data: {
              cajaId: dto.cajaId!,
              empresaId,
              tipo: TipoMovimientoCaja.EGRESO,
              categoria: CategoriaMovimientoCaja.GASTO_OPERATIVO,
              categoriaGastoId: gasto.categoriaGastoId,
              metodoPago: dto.metodoPago,
              monto: dto.montoReal,
              descripcion: `Pago gasto recurrente: ${gasto.nombre} (${dto.periodo})`,
              esManual: false,
              registradoPorId: usuarioId,
            },
            select: { id: true },
          });
          movimientoCajaId = movimiento.id;
        } else {
          // BANCO: decrementa saldo. Se permite saldo negativo
          // (advertencia en UI, no bloqueamos a nivel API).
          await tx.empresaBanco.update({
            where: { id: dto.bancoId! },
            data: { saldoActual: { decrement: dto.montoReal } },
          });
        }

        const pago = await tx.pagoGastoRecurrente.create({
          data: {
            gastoRecurrenteId: gasto.id,
            empresaId,
            periodo: dto.periodo,
            montoReal: dto.montoReal,
            fuente: dto.fuente,
            metodoPago: dto.metodoPago,
            bancoId: dto.fuente === FuentePagoGasto.BANCO ? dto.bancoId : null,
            movimientoCajaId,
            comprobanteUrl: dto.comprobanteUrl ?? null,
            notas: dto.notas?.trim() || null,
            registradoPorId: usuarioId,
          },
          include: {
            banco: { select: { id: true, nombreBanco: true, numeroCuenta: true } },
            movimientoCaja: { select: { id: true, cajaId: true } },
          },
        });

        await tx.gastoRecurrente.update({
          where: { id: gasto.id },
          data: { ultimoPagoEn: pago.fechaPago },
        });

        return pago;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray((err.meta as any)?.target) &&
        ((err.meta as any).target as string[]).includes('periodo')
      ) {
        throw new ConflictException(
          `Ya existe un pago registrado para el período ${dto.periodo}`,
        );
      }
      throw err;
    }
  }

  async listarPagos(
    empresaId: string,
    gastoId: string,
    opts: { take?: number; skip?: number } = {},
  ) {
    const gasto = await this.prisma.gastoRecurrente.findFirst({
      where: { id: gastoId, empresaId },
      select: { id: true },
    });
    if (!gasto) throw new NotFoundException('Gasto recurrente no encontrado');

    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const skip = Math.max(opts.skip ?? 0, 0);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.pagoGastoRecurrente.findMany({
        where: { gastoRecurrenteId: gasto.id },
        orderBy: { fechaPago: 'desc' },
        take,
        skip,
        include: {
          banco: { select: { id: true, nombreBanco: true, numeroCuenta: true } },
          movimientoCaja: { select: { id: true, cajaId: true } },
          registradoPor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      }),
      this.prisma.pagoGastoRecurrente.count({ where: { gastoRecurrenteId: gasto.id } }),
    ]);

    return { items, total, take, skip };
  }

  /**
   * Reportes agregados del módulo:
   *  - evolucionMensual: monto pagado por mes + breakdown por categoría
   *    para los últimos N meses (default 12).
   *  - mesActual: total + breakdown por categoría del mes en curso.
   *
   * Considera SOLO PagoGastoRecurrente (no MovimientoCaja arbitrario).
   * Sirve para responder "¿cuánto pago de luz al mes?" y similares.
   */
  async reportes(empresaId: string, meses = 12) {
    const m = Math.min(Math.max(meses, 1), 24);
    const hoy = new Date();
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - (m - 1), 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59, 999);

    const pagos = await this.prisma.pagoGastoRecurrente.findMany({
      where: {
        empresaId,
        fechaPago: { gte: inicio, lte: fin },
      },
      select: {
        montoReal: true,
        fechaPago: true,
        gastoRecurrente: {
          select: {
            categoriaGasto: {
              select: { id: true, nombre: true, icono: true, color: true },
            },
          },
        },
      },
    });

    type Bucket = { porCategoria: Record<string, number>; total: number };
    const porMes = new Map<string, Bucket>();
    const catMeta: Record<
      string,
      { id: string; nombre: string; icono: string | null; color: string | null }
    > = {};

    for (const p of pagos) {
      const d = p.fechaPago;
      const periodo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!porMes.has(periodo)) {
        porMes.set(periodo, { porCategoria: {}, total: 0 });
      }
      const bucket = porMes.get(periodo)!;
      const monto = Number(p.montoReal);
      bucket.total += monto;
      const cat = p.gastoRecurrente.categoriaGasto;
      bucket.porCategoria[cat.nombre] = (bucket.porCategoria[cat.nombre] ?? 0) + monto;
      catMeta[cat.nombre] = cat;
    }

    // Construir lista contigua de meses (rellena con 0 los sin pagos)
    const evolucionMensual: Array<{
      periodo: string;
      total: number;
      porCategoria: Record<string, number>;
    }> = [];
    for (let i = 0; i < m; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - (m - 1 - i), 1);
      const periodo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = porMes.get(periodo) ?? { porCategoria: {}, total: 0 };
      evolucionMensual.push({
        periodo,
        total: Math.round(bucket.total * 100) / 100,
        porCategoria: Object.fromEntries(
          Object.entries(bucket.porCategoria).map(([k, v]) => [
            k,
            Math.round(v * 100) / 100,
          ]),
        ),
      });
    }

    const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const bucketMesActual = porMes.get(periodoActual) ?? { porCategoria: {}, total: 0 };
    const breakdown = Object.entries(bucketMesActual.porCategoria)
      .map(([nombre, monto]) => ({
        categoriaId: catMeta[nombre]?.id ?? '',
        nombre,
        monto: Math.round(monto * 100) / 100,
        icono: catMeta[nombre]?.icono ?? null,
        color: catMeta[nombre]?.color ?? null,
      }))
      .sort((a, b) => b.monto - a.monto);

    return {
      evolucionMensual,
      mesActual: {
        periodo: periodoActual,
        totalGastado: Math.round(bucketMesActual.total * 100) / 100,
        porCategoria: breakdown,
      },
    };
  }

  async dashboard(empresaId: string, periodo?: string, sedeId?: string) {
    const hoy = new Date();
    const periodoVigente =
      periodo ?? `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodoVigente)) {
      throw new BadRequestException('periodo debe tener formato YYYY-MM');
    }

    const where: any = { empresaId, activo: true };
    if (sedeId === 'null') where.sedeId = null;
    else if (sedeId) where.sedeId = sedeId;

    const gastos = await this.prisma.gastoRecurrente.findMany({
      where,
      orderBy: [{ diaVencimiento: 'asc' }, { nombre: 'asc' }],
      include: {
        ...this.defaultInclude,
        pagos: {
          where: { periodo: periodoVigente },
          select: {
            id: true,
            periodo: true,
            montoReal: true,
            fechaPago: true,
            fuente: true,
            metodoPago: true,
            comprobanteUrl: true,
          },
          take: 1,
        },
      },
    });

    const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    // <0 = consultando un período pasado; 0 = actual; >0 = futuro
    const cmpPeriodo = periodoVigente.localeCompare(periodoActual);
    const diaHoy = hoy.getDate();

    let totalPagado = 0;
    let totalPendiente = 0;
    let totalVencido = 0;

    const items = gastos.map((g) => {
      const pago = g.pagos[0] ?? null;
      let estado: EstadoPeriodoGasto;
      if (pago) {
        estado = 'PAGADO';
        totalPagado += Number(pago.montoReal);
      } else if (cmpPeriodo < 0) {
        // Período pasado sin pago → vencido sí o sí
        estado = 'VENCIDO';
        totalVencido += Number(g.montoEstimado);
      } else if (cmpPeriodo > 0) {
        // Período futuro sin pago → siempre pendiente
        estado = 'PENDIENTE';
        totalPendiente += Number(g.montoEstimado);
      } else if (diaHoy > g.diaVencimiento) {
        // Período actual y ya pasó el día de vencimiento
        estado = 'VENCIDO';
        totalVencido += Number(g.montoEstimado);
      } else {
        estado = 'PENDIENTE';
        totalPendiente += Number(g.montoEstimado);
      }

      const { pagos, ...rest } = g;
      return { ...rest, estado, pagoPeriodo: pago };
    });

    return {
      periodo: periodoVigente,
      resumen: {
        total: items.length,
        pagados: items.filter((i) => i.estado === 'PAGADO').length,
        pendientes: items.filter((i) => i.estado === 'PENDIENTE').length,
        vencidos: items.filter((i) => i.estado === 'VENCIDO').length,
        montoPagado: Math.round(totalPagado * 100) / 100,
        montoPendiente: Math.round(totalPendiente * 100) / 100,
        montoVencido: Math.round(totalVencido * 100) / 100,
      },
      items,
    };
  }

  // --- helpers de validación ---

  private async assertCategoriaEgreso(empresaId: string, categoriaGastoId: string) {
    const cat = await this.prisma.categoriaGasto.findFirst({
      where: { id: categoriaGastoId, empresaId, isActive: true },
      select: { id: true, tipo: true },
    });
    if (!cat) {
      throw new BadRequestException('Categoría de gasto no encontrada o inactiva');
    }
    if (cat.tipo !== TipoCategoriaGasto.EGRESO) {
      throw new BadRequestException('La categoría debe ser de tipo EGRESO');
    }
  }

  private async assertSedePertenece(empresaId: string, sedeId: string) {
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId, deletedAt: null },
      select: { id: true },
    });
    if (!sede) throw new BadRequestException('Sede no pertenece a la empresa');
  }

  private async assertProveedorPertenece(empresaId: string, proveedorId: string) {
    const prov = await this.prisma.proveedor.findFirst({
      where: { id: proveedorId, empresaId, isActive: true },
      select: { id: true },
    });
    if (!prov) throw new BadRequestException('Proveedor no pertenece a la empresa o está inactivo');
  }
}
