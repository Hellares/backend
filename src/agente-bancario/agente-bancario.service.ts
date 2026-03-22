import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { AppLoggerService } from '../common/logger/logger.service';
import {
  Prisma,
  TipoOperacionAgente,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
} from '@prisma/client';

@Injectable()
export class AgenteBancarioService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
    appLogger: AppLoggerService,
  ) {
    this.logger = appLogger.child('AgenteBancarioService');
  }

  /**
   * Crear un nuevo agente bancario
   */
  async crear(
    empresaId: string,
    sedeId: string,
    dto: {
      banco: string;
      codigoAgente?: string;
      fondoAsignado: number;
      comisionDeposito?: number;
      comisionRetiro?: number;
      responsableId?: string;
    },
    usuarioId: string,
  ) {
    const agente = await this.prisma.agenteBancario.create({
      data: {
        empresaId,
        sedeId,
        banco: dto.banco,
        codigoAgente: dto.codigoAgente,
        fondoAsignado: dto.fondoAsignado,
        saldoActual: dto.fondoAsignado,
        comisionDeposito: dto.comisionDeposito ?? 1.5,
        comisionRetiro: dto.comisionRetiro ?? 1.5,
        responsableId: dto.responsableId,
      },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        responsable: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    this.logger.log(`Agente bancario creado: ${agente.banco} en sede ${sedeId}`);
    return agente;
  }

  /**
   * Listar agentes bancarios activos con estadísticas del día
   */
  async listar(empresaId: string, sedeId?: string) {
    const where: Prisma.AgenteBancarioWhereInput = {
      empresaId,
      estado: 'ACTIVO',
    };

    if (sedeId) {
      where.sedeId = sedeId;
    }

    const agentes = await this.prisma.agenteBancario.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        responsable: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    // Obtener estadísticas del día para cada agente
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const agentesConStats = await Promise.all(
      agentes.map(async (agente) => {
        const operacionesHoy = await this.prisma.operacionAgente.groupBy({
          by: ['tipo'],
          where: {
            agenteBancarioId: agente.id,
            anulado: false,
            fechaOperacion: { gte: hoy, lt: manana },
          },
          _count: { id: true },
          _sum: { monto: true, comision: true },
        });

        const depositos = operacionesHoy.find(
          (o) => o.tipo === TipoOperacionAgente.DEPOSITO,
        );
        const retiros = operacionesHoy.find(
          (o) => o.tipo === TipoOperacionAgente.RETIRO,
        );

        const comisionesHoy = operacionesHoy.reduce(
          (sum, o) => sum + Number(o._sum.comision ?? 0),
          0,
        );

        return {
          ...agente,
          estadisticasHoy: {
            depositos: {
              cantidad: depositos?._count.id ?? 0,
              monto: Number(depositos?._sum.monto ?? 0),
            },
            retiros: {
              cantidad: retiros?._count.id ?? 0,
              monto: Number(retiros?._sum.monto ?? 0),
            },
            comisiones: Math.round(comisionesHoy * 100) / 100,
          },
        };
      }),
    );

    return agentesConStats;
  }

  /**
   * Detalle de un agente bancario con últimas 20 operaciones
   */
  async getDetalle(empresaId: string, id: string) {
    const agente = await this.prisma.agenteBancario.findFirst({
      where: { id, empresaId },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        responsable: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    if (!agente) {
      throw new NotFoundException('Agente bancario no encontrado');
    }

    const ultimasOperaciones = await this.prisma.operacionAgente.findMany({
      where: { agenteBancarioId: id },
      orderBy: { fechaOperacion: 'desc' },
      take: 20,
      include: {
        registradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return {
      ...agente,
      ultimasOperaciones,
    };
  }

  /**
   * Actualizar agente bancario
   */
  async actualizar(
    empresaId: string,
    id: string,
    dto: {
      banco?: string;
      codigoAgente?: string;
      comisionDeposito?: number;
      comisionRetiro?: number;
      responsableId?: string;
      fondoAsignado?: number;
    },
  ) {
    const agente = await this.prisma.agenteBancario.findFirst({
      where: { id, empresaId },
    });

    if (!agente) {
      throw new NotFoundException('Agente bancario no encontrado');
    }

    const updated = await this.prisma.agenteBancario.update({
      where: { id },
      data: {
        banco: dto.banco,
        codigoAgente: dto.codigoAgente,
        comisionDeposito: dto.comisionDeposito,
        comisionRetiro: dto.comisionRetiro,
        responsableId: dto.responsableId,
        fondoAsignado: dto.fondoAsignado,
      },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        responsable: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return updated;
  }

  /**
   * Desactivar agente bancario
   */
  async desactivar(empresaId: string, id: string) {
    const agente = await this.prisma.agenteBancario.findFirst({
      where: { id, empresaId },
    });

    if (!agente) {
      throw new NotFoundException('Agente bancario no encontrado');
    }

    await this.prisma.agenteBancario.update({
      where: { id },
      data: { estado: 'INACTIVO' },
    });

    return { message: 'Agente bancario desactivado' };
  }

  /**
   * Registrar operación (depósito o retiro) en un agente bancario.
   * Crea movimientos de caja automáticos (principal + comisión).
   */
  async registrarOperacion(
    empresaId: string,
    agenteId: string,
    dto: {
      tipo: 'DEPOSITO' | 'RETIRO';
      monto: number;
      nombreCliente?: string;
      documentoCliente?: string;
      numeroOperacion?: string;
      observaciones?: string;
    },
    usuarioId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Buscar agente y validar estado
      const agente = await tx.agenteBancario.findFirst({
        where: { id: agenteId, empresaId, estado: 'ACTIVO' },
        include: {
          sede: { select: { id: true, nombre: true } },
        },
      });

      if (!agente) {
        throw new NotFoundException(
          'Agente bancario no encontrado o inactivo',
        );
      }

      // 2. Validar saldo para retiros
      if (
        dto.tipo === 'RETIRO' &&
        Number(agente.saldoActual) < dto.monto
      ) {
        throw new BadRequestException(
          `Saldo insuficiente. Saldo actual: ${agente.saldoActual}, monto solicitado: ${dto.monto}`,
        );
      }

      // 3. Calcular comisión
      const comision =
        dto.tipo === 'DEPOSITO'
          ? Number(agente.comisionDeposito)
          : Number(agente.comisionRetiro);

      // 4. Crear operación
      const operacion = await tx.operacionAgente.create({
        data: {
          agenteBancarioId: agenteId,
          empresaId,
          tipo: dto.tipo as TipoOperacionAgente,
          monto: dto.monto,
          comision,
          nombreCliente: dto.nombreCliente,
          documentoCliente: dto.documentoCliente,
          numeroOperacion: dto.numeroOperacion,
          observaciones: dto.observaciones,
          registradoPorId: usuarioId,
        },
        include: {
          registradoPor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      // 5. Actualizar saldo del agente
      // DEPOSITO: cliente deposita dinero → dinero ENTRA a la caja → saldo incrementa
      // RETIRO: cliente retira dinero → dinero SALE de la caja → saldo decrementa
      await tx.agenteBancario.update({
        where: { id: agenteId },
        data: {
          saldoActual:
            dto.tipo === 'DEPOSITO'
              ? { increment: dto.monto }
              : { decrement: dto.monto },
        },
      });

      // 6. Registrar movimientos en caja (si hay caja abierta)
      // a) Movimiento principal
      const tipoMovimiento =
        dto.tipo === 'DEPOSITO'
          ? TipoMovimientoCaja.INGRESO
          : TipoMovimientoCaja.EGRESO;
      const categoriaMovimiento =
        dto.tipo === 'DEPOSITO'
          ? CategoriaMovimientoCaja.DEPOSITO_AGENTE
          : CategoriaMovimientoCaja.RETIRO_AGENTE;

      await this.cajaService.registrarMovimientoSiHayCaja(
        empresaId,
        agente.sedeId,
        usuarioId,
        {
          tipo: tipoMovimiento,
          categoria: categoriaMovimiento,
          metodoPago: MetodoPagoVenta.EFECTIVO,
          monto: dto.monto,
          descripcion: `${dto.tipo === 'DEPOSITO' ? 'Depósito' : 'Retiro'} agente ${agente.banco}${dto.nombreCliente ? ` - ${dto.nombreCliente}` : ''}`,
        },
        tx,
      );

      // b) Comisión (siempre es ingreso)
      if (comision > 0) {
        await this.cajaService.registrarMovimientoSiHayCaja(
          empresaId,
          agente.sedeId,
          usuarioId,
          {
            tipo: TipoMovimientoCaja.INGRESO,
            categoria: CategoriaMovimientoCaja.COMISION_AGENTE,
            metodoPago: MetodoPagoVenta.EFECTIVO,
            monto: comision,
            descripcion: `Comisión ${dto.tipo.toLowerCase()} agente ${agente.banco}`,
          },
          tx,
        );
      }

      // 7. Retornar operación
      return operacion;
    });
  }

  /**
   * Anular una operación de agente bancario
   */
  async anularOperacion(
    empresaId: string,
    operacionId: string,
    motivo: string,
    usuarioId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Buscar operación
      const operacion = await tx.operacionAgente.findFirst({
        where: { id: operacionId, empresaId },
        include: {
          agenteBancario: true,
        },
      });

      if (!operacion) {
        throw new NotFoundException('Operación no encontrada');
      }

      if (operacion.anulado) {
        throw new BadRequestException('Esta operación ya fue anulada');
      }

      // 2. Revertir saldo del agente
      // Si fue DEPOSITO → se había incrementado, ahora decrementar
      // Si fue RETIRO → se había decrementado, ahora incrementar
      await tx.agenteBancario.update({
        where: { id: operacion.agenteBancarioId },
        data: {
          saldoActual:
            operacion.tipo === TipoOperacionAgente.DEPOSITO
              ? { decrement: Number(operacion.monto) }
              : { increment: Number(operacion.monto) },
        },
      });

      // 3. Marcar operación como anulada
      const operacionAnulada = await tx.operacionAgente.update({
        where: { id: operacionId },
        data: {
          anulado: true,
          motivoAnulacion: motivo,
        },
        include: {
          registradoPor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      this.logger.log(
        `Operación de agente anulada: ${operacionId} - Motivo: ${motivo}`,
      );

      return operacionAnulada;
    });
  }

  /**
   * Listar operaciones de un agente con filtros y paginación
   */
  async getOperaciones(
    empresaId: string,
    agenteId: string,
    filtros?: {
      tipo?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      limit?: number;
    },
  ) {
    const where: Prisma.OperacionAgenteWhereInput = {
      agenteBancarioId: agenteId,
      empresaId,
    };

    if (filtros?.tipo) {
      where.tipo = filtros.tipo as TipoOperacionAgente;
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaOperacion = {};
      if (filtros.fechaDesde) {
        where.fechaOperacion.gte = new Date(filtros.fechaDesde);
      }
      if (filtros.fechaHasta) {
        where.fechaOperacion.lte = new Date(filtros.fechaHasta);
      }
    }

    const operaciones = await this.prisma.operacionAgente.findMany({
      where,
      orderBy: { fechaOperacion: 'desc' },
      take: filtros?.limit ?? 50,
      include: {
        registradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return operaciones;
  }

  /**
   * Resumen/dashboard de agentes bancarios
   */
  async getResumen(empresaId: string, sedeId?: string) {
    const whereAgente: Prisma.AgenteBancarioWhereInput = { empresaId };
    if (sedeId) {
      whereAgente.sedeId = sedeId;
    }

    const agentes = await this.prisma.agenteBancario.findMany({
      where: whereAgente,
      include: {
        sede: { select: { id: true, nombre: true } },
      },
    });

    const totalAgentes = agentes.length;
    const agentesActivos = agentes.filter((a) => a.estado === 'ACTIVO').length;
    const fondoTotalAsignado = agentes.reduce(
      (sum, a) => sum + Number(a.fondoAsignado),
      0,
    );
    const saldoTotalActual = agentes.reduce(
      (sum, a) => sum + Number(a.saldoActual),
      0,
    );

    // Fechas para filtros
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

    const agenteIds = agentes.map((a) => a.id);

    // Operaciones de hoy
    const operacionesHoy = await this.prisma.operacionAgente.groupBy({
      by: ['tipo'],
      where: {
        agenteBancarioId: { in: agenteIds },
        anulado: false,
        fechaOperacion: { gte: hoy, lt: manana },
      },
      _count: { id: true },
      _sum: { monto: true, comision: true },
    });

    const depositosHoy = operacionesHoy.find(
      (o) => o.tipo === TipoOperacionAgente.DEPOSITO,
    );
    const retirosHoy = operacionesHoy.find(
      (o) => o.tipo === TipoOperacionAgente.RETIRO,
    );

    const comisionesHoy = operacionesHoy.reduce(
      (sum, o) => sum + Number(o._sum.comision ?? 0),
      0,
    );

    // Comisiones del mes
    const comisionesMesResult = await this.prisma.operacionAgente.aggregate({
      where: {
        agenteBancarioId: { in: agenteIds },
        anulado: false,
        fechaOperacion: { gte: inicioMes, lt: manana },
      },
      _sum: { comision: true },
    });

    const comisionesMes = Number(comisionesMesResult._sum.comision ?? 0);

    // Estadísticas por agente (hoy)
    const porAgente = await Promise.all(
      agentes.map(async (agente) => {
        const opsHoy = await this.prisma.operacionAgente.groupBy({
          by: ['tipo'],
          where: {
            agenteBancarioId: agente.id,
            anulado: false,
            fechaOperacion: { gte: hoy, lt: manana },
          },
          _count: { id: true },
          _sum: { monto: true, comision: true },
        });

        const dep = opsHoy.find(
          (o) => o.tipo === TipoOperacionAgente.DEPOSITO,
        );
        const ret = opsHoy.find(
          (o) => o.tipo === TipoOperacionAgente.RETIRO,
        );
        const comHoy = opsHoy.reduce(
          (sum, o) => sum + Number(o._sum.comision ?? 0),
          0,
        );

        return {
          id: agente.id,
          banco: agente.banco,
          estado: agente.estado,
          sedeNombre: agente.sede.nombre,
          fondoAsignado: Number(agente.fondoAsignado),
          saldoActual: Number(agente.saldoActual),
          depositosHoy: {
            cantidad: dep?._count.id ?? 0,
            monto: Number(dep?._sum.monto ?? 0),
          },
          retirosHoy: {
            cantidad: ret?._count.id ?? 0,
            monto: Number(ret?._sum.monto ?? 0),
          },
          comisionesHoy: Math.round(comHoy * 100) / 100,
        };
      }),
    );

    return {
      totalAgentes,
      agentesActivos,
      operacionesHoy: {
        depositos: {
          cantidad: depositosHoy?._count.id ?? 0,
          monto: Number(depositosHoy?._sum.monto ?? 0),
        },
        retiros: {
          cantidad: retirosHoy?._count.id ?? 0,
          monto: Number(retirosHoy?._sum.monto ?? 0),
        },
      },
      comisionesHoy: Math.round(comisionesHoy * 100) / 100,
      comisionesMes: Math.round(comisionesMes * 100) / 100,
      fondoTotalAsignado: Math.round(fondoTotalAsignado * 100) / 100,
      saldoTotalActual: Math.round(saldoTotalActual * 100) / 100,
      porAgente,
    };
  }
}
