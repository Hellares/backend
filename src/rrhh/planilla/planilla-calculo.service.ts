import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EstadoEmpleado,
  EstadoAsistencia,
  EstadoPeriodoPlanilla,
  EstadoAdelanto,
  TipoDetalleBoleta,
  ConceptoBoleta,
  Prisma,
} from '@prisma/client';

@Injectable()
export class PlanillaCalculoService {
  constructor(private readonly prisma: PrismaService) {}

  // =============================================================
  // CALCULAR PLANILLA COMPLETA PARA UN PERIODO
  // =============================================================

  async calcularPlanilla(empresaId: string, periodoId: string, usuarioId: string) {
    // 1. Obtener el periodo
    const periodo = await this.prisma.periodoPlanilla.findFirst({
      where: { id: periodoId, empresaId },
    });

    if (!periodo) {
      throw new NotFoundException('Periodo de planilla no encontrado');
    }

    if (periodo.estado !== EstadoPeriodoPlanilla.BORRADOR && periodo.estado !== EstadoPeriodoPlanilla.CALCULADA) {
      throw new BadRequestException(
        'Solo se puede calcular un periodo en estado BORRADOR o CALCULADA (recalcular)',
      );
    }

    // 2. Obtener configuración de la empresa
    const config = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
    });

    if (!config) {
      throw new BadRequestException(
        'No se encontró la configuración de empresa. Configure los parámetros de planilla primero.',
      );
    }

    const horasExtraPorcentaje = config.horasExtraPorcentaje;
    const essaludPorcentaje = config.essaludPorcentaje;

    // 3. Obtener empleados activos
    const whereEmpleado: Prisma.EmpleadoWhereInput = {
      empresaId,
      estado: EstadoEmpleado.ACTIVO,
      isActive: true,
      deletedAt: null,
    };

    if (periodo.sedeId) {
      whereEmpleado.sedeId = periodo.sedeId;
    }

    const empleados = await this.prisma.empleado.findMany({
      where: whereEmpleado,
      include: {
        usuario: {
          select: {
            persona: {
              select: { nombres: true, apellidos: true },
            },
          },
        },
      },
    });

    if (empleados.length === 0) {
      throw new BadRequestException(
        'No se encontraron empleados activos para este periodo',
      );
    }

    // 4. Calcular boletas dentro de una transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Eliminar boletas y detalles existentes (recalcular)
      const boletasExistentes = await tx.boletaPago.findMany({
        where: { periodoId, empresaId },
        select: { id: true },
      });

      if (boletasExistentes.length > 0) {
        const boletaIds = boletasExistentes.map((b) => b.id);

        await tx.detalleBoletaPago.deleteMany({
          where: { boletaId: { in: boletaIds } },
        });

        // Desmarcar adelantos que estaban vinculados a estas boletas
        await tx.adelantoPago.updateMany({
          where: { descontadoEnBoletaId: { in: boletaIds } },
          data: {
            descontadoEnBoletaId: null,
            estado: EstadoAdelanto.PAGADO_ADELANTO,
          },
        });

        await tx.boletaPago.deleteMany({
          where: { id: { in: boletaIds } },
        });
      }

      let periodoTotalBruto = new Prisma.Decimal(0);
      let periodoTotalDescuentos = new Prisma.Decimal(0);
      let periodoTotalNeto = new Prisma.Decimal(0);
      let periodoTotalAportaciones = new Prisma.Decimal(0);

      // Calcular para cada empleado
      for (const empleado of empleados) {
        const salarioBase = new Prisma.Decimal(empleado.salarioBase.toString());

        // a. Obtener asistencias en el rango de fechas
        const asistencias = await tx.asistencia.findMany({
          where: {
            empleadoId: empleado.id,
            empresaId,
            fecha: {
              gte: periodo.fechaInicio,
              lte: periodo.fechaFin,
            },
          },
        });

        // b. Contar días
        let diasPresente = 0;
        let diasFalta = 0;
        let diasTardanza = 0;
        let totalHorasExtra = new Prisma.Decimal(0);

        for (const asistencia of asistencias) {
          if (
            asistencia.estado === EstadoAsistencia.PRESENTE ||
            asistencia.estado === EstadoAsistencia.TARDANZA
          ) {
            diasPresente++;
          }

          if (asistencia.estado === EstadoAsistencia.FALTA) {
            diasFalta++;
          }

          if (asistencia.estado === EstadoAsistencia.TARDANZA) {
            diasTardanza++;
          }

          if (asistencia.horasExtra) {
            totalHorasExtra = totalHorasExtra.add(
              new Prisma.Decimal(asistencia.horasExtra.toString()),
            );
          }
        }

        const diasTrabajados = diasPresente;
        const horasExtraNum = Number(totalHorasExtra);

        // c. Calcular detalles de la boleta
        const detalles: {
          tipo: TipoDetalleBoleta;
          concepto: ConceptoBoleta;
          descripcion: string;
          monto: Prisma.Decimal;
          porcentaje: Prisma.Decimal | null;
        }[] = [];

        // INGRESO: Salario básico proporcional
        const salarioProporcional = salarioBase.div(30).mul(diasTrabajados);
        detalles.push({
          tipo: TipoDetalleBoleta.INGRESO,
          concepto: ConceptoBoleta.SALARIO_BASICO,
          descripcion: `Salario básico (${diasTrabajados} días)`,
          monto: new Prisma.Decimal(salarioProporcional.toFixed(2)),
          porcentaje: null,
        });

        // INGRESO: Horas extra
        if (horasExtraNum > 0) {
          const tarifaHoraBase = salarioBase.div(240);
          const factorExtra = 1 + horasExtraPorcentaje / 100;
          const montoHorasExtra = tarifaHoraBase
            .mul(horasExtraNum)
            .mul(factorExtra);

          detalles.push({
            tipo: TipoDetalleBoleta.INGRESO,
            concepto: ConceptoBoleta.HORAS_EXTRA,
            descripcion: `Horas extra (${horasExtraNum}h al ${horasExtraPorcentaje}% adicional)`,
            monto: new Prisma.Decimal(montoHorasExtra.toFixed(2)),
            porcentaje: new Prisma.Decimal(horasExtraPorcentaje),
          });
        }

        // Calcular total ingresos
        let totalIngresos = new Prisma.Decimal(0);
        for (const d of detalles) {
          if (d.tipo === TipoDetalleBoleta.INGRESO) {
            totalIngresos = totalIngresos.add(d.monto);
          }
        }

        // DESCUENTO: Faltas
        if (diasFalta > 0) {
          const descuentoFaltas = salarioBase.div(30).mul(diasFalta);
          detalles.push({
            tipo: TipoDetalleBoleta.DESCUENTO,
            concepto: ConceptoBoleta.FALTAS,
            descripcion: `Descuento por faltas (${diasFalta} días)`,
            monto: new Prisma.Decimal(descuentoFaltas.toFixed(2)),
            porcentaje: null,
          });
        }

        // DESCUENTO: Adelantos pendientes
        const adelantosPendientes = await tx.adelantoPago.findMany({
          where: {
            empleadoId: empleado.id,
            empresaId,
            estado: {
              in: [EstadoAdelanto.APROBADO_ADELANTO, EstadoAdelanto.PAGADO_ADELANTO],
            },
            descontadoEnBoletaId: null,
          },
        });

        let totalAdelantos = new Prisma.Decimal(0);
        for (const adelanto of adelantosPendientes) {
          totalAdelantos = totalAdelantos.add(
            new Prisma.Decimal(adelanto.monto.toString()),
          );
        }

        if (totalAdelantos.gt(0)) {
          detalles.push({
            tipo: TipoDetalleBoleta.DESCUENTO,
            concepto: ConceptoBoleta.ADELANTO_DESCUENTO,
            descripcion: `Descuento por adelanto(s) de sueldo (${adelantosPendientes.length})`,
            monto: new Prisma.Decimal(totalAdelantos.toFixed(2)),
            porcentaje: null,
          });
        }

        // Calcular total descuentos
        let totalDescuentos = new Prisma.Decimal(0);
        for (const d of detalles) {
          if (d.tipo === TipoDetalleBoleta.DESCUENTO) {
            totalDescuentos = totalDescuentos.add(d.monto);
          }
        }

        // APORTE EMPLEADOR: EsSalud
        const montoEssalud = totalIngresos.mul(essaludPorcentaje).div(100);
        detalles.push({
          tipo: TipoDetalleBoleta.APORTE_EMPLEADOR,
          concepto: ConceptoBoleta.ESSALUD_EMPLEADOR,
          descripcion: `EsSalud empleador (${essaludPorcentaje}%)`,
          monto: new Prisma.Decimal(montoEssalud.toFixed(2)),
          porcentaje: new Prisma.Decimal(essaludPorcentaje),
        });

        // Calcular total aportaciones
        let totalAportaciones = new Prisma.Decimal(0);
        for (const d of detalles) {
          if (d.tipo === TipoDetalleBoleta.APORTE_EMPLEADOR) {
            totalAportaciones = totalAportaciones.add(d.monto);
          }
        }

        // Total neto
        const totalNeto = totalIngresos.sub(totalDescuentos);

        // Crear boleta
        const boleta = await tx.boletaPago.create({
          data: {
            periodoId,
            empleadoId: empleado.id,
            empresaId,
            diasTrabajados,
            diasFalta,
            diasTardanza,
            horasExtra: totalHorasExtra,
            salarioBase,
            totalIngresos: new Prisma.Decimal(totalIngresos.toFixed(2)),
            totalDescuentos: new Prisma.Decimal(totalDescuentos.toFixed(2)),
            totalAportaciones: new Prisma.Decimal(totalAportaciones.toFixed(2)),
            totalNeto: new Prisma.Decimal(totalNeto.toFixed(2)),
            detalles: {
              create: detalles.map((d) => ({
                tipo: d.tipo,
                concepto: d.concepto,
                descripcion: d.descripcion,
                monto: d.monto,
                porcentaje: d.porcentaje,
              })),
            },
          },
        });

        // Marcar adelantos como descontados
        if (adelantosPendientes.length > 0) {
          await tx.adelantoPago.updateMany({
            where: {
              id: { in: adelantosPendientes.map((a) => a.id) },
            },
            data: {
              estado: EstadoAdelanto.DESCONTADO_ADELANTO,
              descontadoEnBoletaId: boleta.id,
            },
          });
        }

        // Acumular totales del periodo
        periodoTotalBruto = periodoTotalBruto.add(totalIngresos);
        periodoTotalDescuentos = periodoTotalDescuentos.add(totalDescuentos);
        periodoTotalNeto = periodoTotalNeto.add(totalNeto);
        periodoTotalAportaciones = periodoTotalAportaciones.add(totalAportaciones);
      }

      // 5. Actualizar totales del periodo
      const periodoActualizado = await tx.periodoPlanilla.update({
        where: { id: periodoId },
        data: {
          estado: EstadoPeriodoPlanilla.CALCULADA,
          totalBruto: new Prisma.Decimal(periodoTotalBruto.toFixed(2)),
          totalDescuentos: new Prisma.Decimal(periodoTotalDescuentos.toFixed(2)),
          totalNeto: new Prisma.Decimal(periodoTotalNeto.toFixed(2)),
          totalAportaciones: new Prisma.Decimal(periodoTotalAportaciones.toFixed(2)),
          calculadoPorId: usuarioId,
        },
        include: {
          _count: { select: { boletasPago: true } },
        },
      });

      return periodoActualizado;
    });

    return result;
  }
}
