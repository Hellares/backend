import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoOrdenServicio } from '@prisma/client';
import { CreateServicioComponenteDto } from './dto/create-servicio-componente.dto';
import { UpdateServicioComponenteDto } from './dto/update-servicio-componente.dto';

// B7 FIX: Estados en los que no se pueden agregar/eliminar componentes
const ESTADOS_NO_MODIFICABLES: EstadoOrdenServicio[] = [
  EstadoOrdenServicio.CANCELADO,
  EstadoOrdenServicio.FINALIZADO,
  EstadoOrdenServicio.TERCERIZADO,
  EstadoOrdenServicio.ENTREGADO,
];

@Injectable()
export class ServicioComponenteService {
  constructor(private prisma: PrismaService) {}

  /**
   * Modelo aditivo: el total facturable = costoTotal (servicio) + Σ componentes.
   * Al BAJAR/QUITAR un componente, el total puede caer por debajo del
   * adelanto/descuento ya registrado → la orden quedaría con saldo negativo
   * (incobrable). Se rechaza el cambio con un mensaje claro.
   */
  private async assertSaldoNoNegativoTrasCambio(
    ordenServicioId: string,
    proyectar: (
      actuales: Array<{ id: string; costoAccion: any; costoRepuestos: any }>,
    ) => Array<{ costoAccion: any; costoRepuestos: any }>,
  ) {
    const orden = await this.prisma.ordenServicio.findUnique({
      where: { id: ordenServicioId },
      select: {
        costoTotal: true,
        adelanto: true,
        descuento: true,
        componentes: { select: { id: true, costoAccion: true, costoRepuestos: true } },
      },
    });
    if (!orden) return;
    const compSub = proyectar(orden.componentes).reduce(
      (s, c) => s + Number(c.costoAccion ?? 0) + Number(c.costoRepuestos ?? 0),
      0,
    );
    const facturable = Math.round((Number(orden.costoTotal ?? 0) + compSub) * 100) / 100;
    const cargas = Math.round((Number(orden.adelanto ?? 0) + Number(orden.descuento ?? 0)) * 100) / 100;
    if (cargas > facturable) {
      throw new BadRequestException(
        `Este cambio dejaría el total (S/ ${facturable.toFixed(2)}) por debajo del adelanto/descuento ya registrado (S/ ${cargas.toFixed(2)}). Reduce primero el adelanto/descuento de la orden.`,
      );
    }
  }

  async create(empresaId: string, ordenServicioId: string, dto: CreateServicioComponenteDto) {
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenServicioId, empresaId },
    });
    if (!orden) throw new NotFoundException('Orden de servicio no encontrada');

    // B7 FIX: Validar estado de la orden
    if (ESTADOS_NO_MODIFICABLES.includes(orden.estado)) {
      throw new BadRequestException(
        `No se pueden agregar componentes a una orden en estado ${orden.estado}`,
      );
    }

    const componente = await this.prisma.componente.findFirst({
      where: { id: dto.componenteId, empresaId, deletedAt: null, isActive: true },
    });
    if (!componente) throw new NotFoundException('Componente no encontrado o inactivo');

    // B11 FIX: Verificar que el componente no esté ya asociado a esta orden
    const existente = await this.prisma.servicioComponente.findFirst({
      where: { ordenServicioId, componenteId: dto.componenteId },
    });
    if (existente) {
      throw new BadRequestException('Este componente ya está asociado a esta orden');
    }

    return this.prisma.servicioComponente.create({
      data: { ordenServicioId, ...dto },
      include: { componente: { include: { tipoComponente: true } } },
    });
  }

  async findByOrden(empresaId: string, ordenServicioId: string) {
    // Validate orden belongs to empresa
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenServicioId, empresaId },
    });
    if (!orden) throw new NotFoundException('Orden de servicio no encontrada');

    return this.prisma.servicioComponente.findMany({
      where: { ordenServicioId },
      include: {
        componente: {
          include: { tipoComponente: true },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async update(
    empresaId: string,
    id: string,
    dto: UpdateServicioComponenteDto,
  ) {
    const servicioComponente = await this.prisma.servicioComponente.findUnique({
      where: { id },
      include: { ordenServicio: { select: { empresaId: true, estado: true } } },
    });

    if (!servicioComponente) {
      throw new NotFoundException('Componente de servicio no encontrado');
    }

    if (servicioComponente.ordenServicio.empresaId !== empresaId) {
      throw new BadRequestException('El componente no pertenece a esta empresa');
    }

    // Mismos estados bloqueados que para agregar/eliminar.
    if (ESTADOS_NO_MODIFICABLES.includes(servicioComponente.ordenServicio.estado)) {
      throw new BadRequestException(
        `No se pueden editar componentes de una orden en estado ${servicioComponente.ordenServicio.estado}`,
      );
    }

    // Si baja el costo del componente, no dejar la orden con saldo negativo.
    await this.assertSaldoNoNegativoTrasCambio(
      servicioComponente.ordenServicioId,
      (actuales) =>
        actuales.map((c) =>
          c.id === id
            ? {
                costoAccion: dto.costoAccion !== undefined ? dto.costoAccion : c.costoAccion,
                costoRepuestos: dto.costoRepuestos !== undefined ? dto.costoRepuestos : c.costoRepuestos,
              }
            : c,
        ),
    );

    return this.prisma.servicioComponente.update({
      where: { id },
      data: { ...dto },
      include: { componente: { include: { tipoComponente: true } } },
    });
  }

  async remove(empresaId: string, id: string) {
    const servicioComponente = await this.prisma.servicioComponente.findUnique({
      where: { id },
      include: { ordenServicio: { select: { empresaId: true, estado: true } } },
    });

    if (!servicioComponente) {
      throw new NotFoundException('Componente de servicio no encontrado');
    }

    if (servicioComponente.ordenServicio.empresaId !== empresaId) {
      throw new BadRequestException('El componente no pertenece a esta empresa');
    }

    // B7 FIX: Validar estado de la orden
    if (ESTADOS_NO_MODIFICABLES.includes(servicioComponente.ordenServicio.estado)) {
      throw new BadRequestException(
        `No se pueden eliminar componentes de una orden en estado ${servicioComponente.ordenServicio.estado}`,
      );
    }

    // Quitar el componente no debe dejar la orden con saldo negativo.
    await this.assertSaldoNoNegativoTrasCambio(
      servicioComponente.ordenServicioId,
      (actuales) => actuales.filter((c) => c.id !== id),
    );

    return this.prisma.servicioComponente.delete({
      where: { id },
    });
  }
}
