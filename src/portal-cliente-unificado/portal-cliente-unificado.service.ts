import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PortalClienteUnificadoService {
  constructor(private readonly prisma: PrismaService) {}

  async getActividadUnificada(usuarioId: string) {
    // 1. Obtener personaId del usuario
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { personaId: true },
    });

    if (!usuario) return { empresas: [] };

    // 2. Obtener todas las EmpresaPersona donde es CLIENTE
    const empresasPersona = await this.prisma.empresaPersona.findMany({
      where: {
        personaId: usuario.personaId,
        rol: 'CLIENTE',
        isActive: true,
        deletedAt: null,
      },
      include: {
        empresa: {
          select: { id: true, nombre: true, logo: true, subdominio: true },
        },
      },
    });

    if (empresasPersona.length === 0) return { empresas: [] };

    // 3. Para cada empresa, obtener actividad reciente en paralelo
    const empresasActividad = await Promise.all(
      empresasPersona.map(async (ep) => {
        const [cotizaciones, ventas, citas, ordenesServicio] = await Promise.all([
          this.prisma.cotizacion.findMany({
            where: { clienteId: ep.id },
            select: {
              id: true,
              codigo: true,
              estado: true,
              total: true,
              moneda: true,
              fechaEmision: true,
              nombreCliente: true,
            },
            orderBy: { creadoEn: 'desc' },
            take: 5,
          }),
          this.prisma.venta.findMany({
            where: { clienteId: ep.id },
            select: {
              id: true,
              codigo: true,
              estado: true,
              total: true,
              moneda: true,
              fechaVenta: true,
              nombreCliente: true,
            },
            orderBy: { creadoEn: 'desc' },
            take: 5,
          }),
          this.prisma.cita.findMany({
            where: { clienteId: ep.id },
            select: {
              id: true,
              codigo: true,
              estado: true,
              fecha: true,
              horaInicio: true,
              horaFin: true,
              servicio: { select: { nombre: true } },
            },
            orderBy: { fecha: 'desc' },
            take: 5,
          }),
          this.prisma.ordenServicio.findMany({
            where: { clienteId: ep.id },
            select: {
              id: true,
              codigo: true,
              estado: true,
              tipoServicio: true,
              costoTotal: true,
              creadoEn: true,
            },
            orderBy: { creadoEn: 'desc' },
            take: 5,
          }),
        ]);

        return {
          empresa: ep.empresa,
          cotizaciones: cotizaciones.map((c) => ({
            id: c.id,
            codigo: c.codigo,
            estado: c.estado,
            total: Number(c.total),
            moneda: c.moneda,
            fecha: c.fechaEmision,
          })),
          ventas: ventas.map((v) => ({
            id: v.id,
            codigo: v.codigo,
            estado: v.estado,
            total: Number(v.total),
            moneda: v.moneda,
            fecha: v.fechaVenta,
          })),
          citas: citas.map((c) => ({
            id: c.id,
            codigo: c.codigo,
            estado: c.estado,
            fecha: c.fecha,
            horaInicio: c.horaInicio,
            horaFin: c.horaFin,
            descripcion: c.servicio?.nombre,
          })),
          ordenesServicio: ordenesServicio.map((o) => ({
            id: o.id,
            codigo: o.codigo,
            estado: o.estado,
            costoTotal: o.costoTotal ? Number(o.costoTotal) : null,
            fecha: o.creadoEn,
            descripcion: o.tipoServicio,
          })),
        };
      }),
    );

    // Filtrar empresas sin actividad
    const empresasConActividad = empresasActividad.filter(
      (e) =>
        e.cotizaciones.length > 0 ||
        e.ventas.length > 0 ||
        e.citas.length > 0 ||
        e.ordenesServicio.length > 0,
    );

    return { empresas: empresasConActividad };
  }
}
