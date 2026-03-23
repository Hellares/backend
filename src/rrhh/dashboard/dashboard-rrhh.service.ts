import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardRrhhService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(empresaId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Ejecutar queries en paralelo (sin $transaction para evitar problemas con groupBy types)
    const [
      totalEmpleados,
      empleadosActivos,
      asistenciasHoy,
      incidenciasPendientes,
      planillaActualRaw,
      adelantosPendientes,
      adelantosAprobadosSinPagar,
      montoAdelantosAprobadosRaw,
      empleadosSinHorario,
    ] = await Promise.all([
      // 1. Total empleados activos
      this.prisma.empleado.count({
        where: { empresaId, isActive: true, deletedAt: null },
      }),

      // 2. Empleados activos con sede info
      this.prisma.empleado.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          estado: true,
          sedeId: true,
          departamento: true,
          sede: { select: { id: true, nombre: true } },
        },
      }),

      // 3. Asistencias de hoy
      this.prisma.asistencia.findMany({
        where: { empresaId, fecha: today },
        select: { estado: true },
      }),

      // 4. Incidencias pendientes
      this.prisma.incidencia.count({
        where: { empresaId, estado: 'PENDIENTE' },
      }),

      // 5. Planilla actual
      this.prisma.periodoPlanilla.findFirst({
        where: { empresaId },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
        include: {
          boletasPago: { select: { estado: true } },
        },
      }),

      // 6. Adelantos pendientes
      this.prisma.adelantoPago.count({
        where: { empresaId, estado: 'PENDIENTE_ADELANTO' },
      }),

      // 7. Adelantos aprobados sin pagar
      this.prisma.adelantoPago.count({
        where: { empresaId, estado: 'APROBADO_ADELANTO' },
      }),

      // 8. Monto adelantos aprobados
      this.prisma.adelantoPago.aggregate({
        where: { empresaId, estado: 'APROBADO_ADELANTO' },
        _sum: { monto: true },
      }),

      // 9. Empleados sin horario
      this.prisma.empleado.count({
        where: { empresaId, isActive: true, deletedAt: null, horarioPlantillaId: null },
      }),
    ]);

    // ---- Procesar empleados por estado ----
    const estadoCount = new Map<string, number>();
    const sedeMap = new Map<string, { sedeId: string; sedeNombre: string; count: number }>();
    const deptoCount = new Map<string, number>();

    for (const emp of empleadosActivos) {
      // Por estado
      estadoCount.set(emp.estado, (estadoCount.get(emp.estado) ?? 0) + 1);

      // Por sede
      const existing = sedeMap.get(emp.sedeId);
      if (existing) {
        existing.count++;
      } else {
        sedeMap.set(emp.sedeId, {
          sedeId: emp.sede.id,
          sedeNombre: emp.sede.nombre,
          count: 1,
        });
      }

      // Por departamento
      const depto = emp.departamento ?? 'Sin departamento';
      deptoCount.set(depto, (deptoCount.get(depto) ?? 0) + 1);
    }

    const empleadosPorEstado = Array.from(estadoCount.entries()).map(([estado, count]) => ({ estado, count }));
    const empleadosPorSede = Array.from(sedeMap.values());
    const empleadosPorDepartamento = Array.from(deptoCount.entries()).map(([departamento, count]) => ({ departamento, count }));

    // ---- Procesar asistencia hoy ----
    const asistMap = new Map<string, number>();
    for (const a of asistenciasHoy) {
      asistMap.set(a.estado, (asistMap.get(a.estado) ?? 0) + 1);
    }

    const presentes = (asistMap.get('PRESENTE') ?? 0) + (asistMap.get('TARDANZA') ?? 0);
    const ausentes = asistMap.get('FALTA') ?? 0;
    const tardanzas = asistMap.get('TARDANZA') ?? 0;
    const justificados = asistMap.get('JUSTIFICADO') ?? 0;
    const enVacacion = asistMap.get('VACACION') ?? 0;
    const enLicencia = asistMap.get('LICENCIA') ?? 0;
    const totalRegistrados = presentes + ausentes + justificados + enVacacion + enLicencia
      + (asistMap.get('DESCANSO') ?? 0) + (asistMap.get('FERIADO') ?? 0);

    const asistenciaHoy = {
      presentes,
      ausentes,
      tardanzas,
      justificados,
      enVacacion,
      enLicencia,
      sinRegistro: Math.max(0, totalEmpleados - totalRegistrados),
    };

    // ---- Procesar planilla actual ----
    let planillaActual: any = null;
    if (planillaActualRaw) {
      planillaActual = {
        periodo: planillaActualRaw.periodo,
        estado: planillaActualRaw.estado,
        totalBruto: planillaActualRaw.totalBruto ? Number(planillaActualRaw.totalBruto) : null,
        totalNeto: planillaActualRaw.totalNeto ? Number(planillaActualRaw.totalNeto) : null,
        boletasPendientes: planillaActualRaw.boletasPago.filter((b) => b.estado === 'PENDIENTE_BOLETA').length,
        boletasPagadas: planillaActualRaw.boletasPago.filter((b) => b.estado === 'PAGADA_BOLETA').length,
      };
    }

    // ---- Alertas ----
    const alertas: { tipo: string; mensaje: string; cantidad: number }[] = [];

    if (empleadosSinHorario > 0) {
      alertas.push({
        tipo: 'EMPLEADOS_SIN_HORARIO',
        mensaje: `Hay ${empleadosSinHorario} empleado(s) sin horario asignado`,
        cantidad: empleadosSinHorario,
      });
    }

    if (incidenciasPendientes > 0) {
      alertas.push({
        tipo: 'INCIDENCIAS_PENDIENTES',
        mensaje: `Hay ${incidenciasPendientes} incidencia(s) pendientes de aprobacion`,
        cantidad: incidenciasPendientes,
      });
    }

    return {
      totalEmpleados,
      empleadosPorEstado,
      empleadosPorSede,
      empleadosPorDepartamento,
      asistenciaHoy,
      incidenciasPendientes,
      planillaActual,
      adelantosPendientes,
      adelantosAprobadosSinPagar,
      montoAdelantosAprobados: Number(montoAdelantosAprobadosRaw._sum.monto ?? 0),
      alertas,
    };
  }
}
