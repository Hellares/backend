import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { StorageService } from '../storage/storage.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { CrearSolicitudPagoDto } from './dto/crear-solicitud-pago.dto';
import { EstadoPagoSuscripcion, PeriodoSuscripcion, MetodoPagoSuscripcion, TipoNotificacion, EntidadTipo } from '@prisma/client';

@Injectable()
export class PagoSuscripcionService {
  constructor(
    private prisma: PrismaService,
    private logger: AppLoggerService,
    private storageService: StorageService,
    private notificacionService: NotificacionService,
  ) {
    this.logger.setContext(PagoSuscripcionService.name);
  }

  async solicitarPago(empresaId: string, userId: string, dto: CrearSolicitudPagoDto) {
    // 1. Verify empresa exists and user has access
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true, planSuscripcionId: true, fechaVencimiento: true },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    // 2. Get plan and calculate price
    const plan = await this.prisma.planSuscripcion.findUnique({
      where: { id: dto.planSuscripcionId },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    // Calculate amount based on period
    let monto: number;
    switch (dto.periodo) {
      case PeriodoSuscripcion.SEMESTRAL:
        monto = plan.precioSemestral ? Number(plan.precioSemestral) : Number(plan.precio) * 6;
        break;
      case PeriodoSuscripcion.ANUAL:
        monto = plan.precioAnual ? Number(plan.precioAnual) : Number(plan.precio) * 12;
        break;
      default:
        monto = Number(plan.precio);
    }

    // 3. Calculate dates
    const fechaInicio = empresa.fechaVencimiento && empresa.fechaVencimiento > new Date()
      ? empresa.fechaVencimiento  // Start from current expiry if still active
      : new Date();               // Start from now if expired

    const fechaFin = new Date(fechaInicio);
    switch (dto.periodo) {
      case PeriodoSuscripcion.MENSUAL: fechaFin.setMonth(fechaFin.getMonth() + 1); break;
      case PeriodoSuscripcion.TRIMESTRAL: fechaFin.setMonth(fechaFin.getMonth() + 3); break;
      case PeriodoSuscripcion.SEMESTRAL: fechaFin.setMonth(fechaFin.getMonth() + 6); break;
      case PeriodoSuscripcion.ANUAL: fechaFin.setFullYear(fechaFin.getFullYear() + 1); break;
      default: fechaFin.setMonth(fechaFin.getMonth() + 1);
    }

    // 4. Create payment record
    const pago = await this.prisma.pagoSuscripcion.create({
      data: {
        empresaId,
        planSuscripcionId: dto.planSuscripcionId,
        monto,
        periodo: dto.periodo,
        metodoPago: dto.metodoPago || MetodoPagoSuscripcion.YAPE,
        estado: EstadoPagoSuscripcion.PENDIENTE,
        fechaInicio,
        fechaFin,
        registradoPor: userId,
      },
      include: {
        planSuscripcion: { select: { nombre: true, precio: true } },
      },
    });

    this.logger.log(`Solicitud de pago creada para empresa ${empresa.nombre}`, {
      pagoId: pago.id, monto, plan: plan.nombre, periodo: dto.periodo,
    });

    return {
      ...pago,
      monto: Number(pago.monto),
      planNombre: pago.planSuscripcion?.nombre,
    };
  }

  async subirComprobante(pagoId: string, userId: string, file: any) {
    const pago = await this.prisma.pagoSuscripcion.findUnique({
      where: { id: pagoId },
      include: { empresa: { select: { nombre: true } } },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    if (pago.estado !== EstadoPagoSuscripcion.PENDIENTE) {
      throw new BadRequestException('Solo se puede subir comprobante para pagos pendientes');
    }

    // Upload image via storage service
    const archivo = await this.storageService.uploadArchivo({
      empresaId: pago.empresaId,
      file,
      entidadTipo: EntidadTipo.PAGO_SUSCRIPCION,
      entidadId: pagoId,
      categoria: 'PRINCIPAL',
      subidoPor: userId,
    });

    // Update payment with proof URL
    const updated = await this.prisma.pagoSuscripcion.update({
      where: { id: pagoId },
      data: {
        comprobantePagoUrl: archivo.url,
        pagoEnviadoEn: new Date(),
        metodoPago: pago.metodoPago,
      },
    });

    this.logger.log(`Comprobante subido para pago ${pagoId}`, { empresa: pago.empresa?.nombre });

    // Notify super admins (users with rolGlobal = SUPER_ADMIN)
    try {
      const admins = await this.prisma.usuario.findMany({
        where: { rolGlobal: 'SUPER_ADMIN', isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (admins.length > 0) {
        await this.notificacionService.enviarAUsuarios(
          admins.map(a => a.id),
          'Nuevo comprobante de pago',
          `${pago.empresa?.nombre} ha enviado un comprobante de pago por S/ ${Number(pago.monto).toFixed(2)}`,
          { tipo: TipoNotificacion.SISTEMA, data: { pagoId, source: 'pago-suscripcion' } },
        );
      }
    } catch (e) {
      this.logger.warn(`Error notificando admins: ${e?.message}`);
    }

    return {
      message: 'Comprobante enviado exitosamente',
      comprobanteUrl: archivo.url,
    };
  }

  async getMisPagos(empresaId: string, page = 1, pageSize = 20) {
    const [items, total] = await Promise.all([
      this.prisma.pagoSuscripcion.findMany({
        where: { empresaId },
        include: {
          planSuscripcion: { select: { nombre: true } },
        },
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.pagoSuscripcion.count({ where: { empresaId } }),
    ]);

    return {
      items: items.map(p => ({
        ...p,
        monto: Number(p.monto),
        planNombre: p.planSuscripcion?.nombre,
        planSuscripcion: undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getPagoById(pagoId: string) {
    const pago = await this.prisma.pagoSuscripcion.findUnique({
      where: { id: pagoId },
      include: {
        planSuscripcion: { select: { nombre: true, precio: true } },
        empresa: { select: { nombre: true } },
      },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    return {
      ...pago,
      monto: Number(pago.monto),
      planNombre: pago.planSuscripcion?.nombre,
      empresaNombre: pago.empresa?.nombre,
      planSuscripcion: undefined,
      empresa: undefined,
    };
  }
}
