import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { FacturacionService } from './facturacion.service';
import { FacturacionProviderFactory } from './providers/facturacion-provider.factory';
import { CrearComunicacionBajaDto } from './dto/comunicacion-baja.dto';
import {
  ComunicacionBajaInput,
  ComunicacionBajaResult,
} from './facturacion-provider.interface';
import { Prisma } from '@prisma/client';

const TIPOS_PERMITIDOS_BAJA = new Set(['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO']);
const PLAZO_DIAS_BAJA = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const TIPO_INTERNO_A_SUNAT: Record<string, string> = {
  FACTURA: '01',
  NOTA_CREDITO: '07',
  NOTA_DEBITO: '08',
};

@Injectable()
export class ComunicacionBajaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: FacturacionProviderFactory,
    private readonly facturacionService: FacturacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('ComunicacionBajaService');
  }

  /**
   * Crea una Comunicación de Baja localmente y en el proveedor.
   * NO la envía a SUNAT — eso se hace con `enviar()` después.
   */
  async crear(empresaId: string, dto: CrearComunicacionBajaDto, userId?: string) {
    if (!dto.detalles?.length) {
      throw new BadRequestException('La comunicación debe incluir al menos 1 documento');
    }

    // 1. Validar fecha referencia: no futura, max 7 días atrás
    const fechaRef = new Date(`${dto.fechaReferencia}T00:00:00`);
    if (Number.isNaN(fechaRef.getTime())) {
      throw new BadRequestException(`fechaReferencia inválida: ${dto.fechaReferencia}`);
    }
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const diasDiff = Math.floor((hoy.getTime() - fechaRef.getTime()) / MS_PER_DAY);
    if (diasDiff < 0) {
      throw new BadRequestException('fechaReferencia no puede ser futura');
    }
    if (diasDiff > PLAZO_DIAS_BAJA) {
      throw new BadRequestException(
        `fechaReferencia tiene ${diasDiff} días. Plazo SUNAT: ${PLAZO_DIAS_BAJA} días. Use Nota de Crédito.`,
      );
    }

    // 2. Validar sede pertenece a la empresa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId },
      select: { id: true },
    });
    if (!sede) throw new BadRequestException('Sede no encontrada o no pertenece a la empresa');

    // 3. Cargar y validar cada comprobante
    const comprobantes = await this.prisma.comprobanteElectronico.findMany({
      where: {
        id: { in: dto.detalles.map((d) => d.comprobanteId) },
        empresaId,
      },
      select: {
        id: true,
        tipoComprobante: true,
        serie: true,
        correlativo: true,
        codigoGenerado: true,
        sunatStatus: true,
        anulado: true,
        proveedorEmisor: true,
        notasRelacionadas: {
          where: { sunatStatus: 'ACEPTADO', anulado: false },
          select: { id: true, codigoGenerado: true },
        },
      },
    });

    const mapaComp = new Map(comprobantes.map((c) => [c.id, c]));
    const ids = dto.detalles.map((d) => d.comprobanteId);

    const errores: string[] = [];
    let proveedorRef: string | null = null;
    for (const detalle of dto.detalles) {
      const c = mapaComp.get(detalle.comprobanteId);
      if (!c) {
        errores.push(`Comprobante ${detalle.comprobanteId} no encontrado en la empresa`);
        continue;
      }
      if (!TIPOS_PERMITIDOS_BAJA.has(c.tipoComprobante)) {
        errores.push(
          `${c.codigoGenerado}: tipo ${c.tipoComprobante} no admite Comunicación de Baja (use Resumen Diario para Boletas)`,
        );
        continue;
      }
      // NC/ND solo si serie empieza con F (FC*/FD*) — BC*/BD* van por Resumen Diario
      if (
        (c.tipoComprobante === 'NOTA_CREDITO' || c.tipoComprobante === 'NOTA_DEBITO') &&
        !c.serie.startsWith('F')
      ) {
        errores.push(
          `${c.codigoGenerado}: notas con serie ${c.serie.charAt(0)} (sobre Boleta) no van por CDB. Use Resumen Diario.`,
        );
        continue;
      }
      if (c.sunatStatus !== 'ACEPTADO') {
        errores.push(`${c.codigoGenerado}: estado SUNAT es ${c.sunatStatus}, debe ser ACEPTADO`);
        continue;
      }
      if (c.anulado) {
        errores.push(`${c.codigoGenerado}: ya está anulado`);
        continue;
      }
      // Facturas con NC/ND aceptadas no pueden ir a baja
      if (c.tipoComprobante === 'FACTURA' && c.notasRelacionadas.length > 0) {
        errores.push(
          `${c.codigoGenerado}: tiene ${c.notasRelacionadas.length} nota(s) aceptada(s) asociada(s). Use Nota de Crédito.`,
        );
        continue;
      }
      // Asegurar que todos vengan del mismo proveedor (no se pueden mezclar)
      if (proveedorRef === null) {
        proveedorRef = c.proveedorEmisor ?? null;
      } else if (c.proveedorEmisor !== proveedorRef) {
        errores.push(`${c.codigoGenerado}: proveedor distinto al del primer documento`);
        continue;
      }
    }
    if (errores.length) {
      throw new BadRequestException(`Validación: ${errores.join(' | ')}`);
    }

    // 4. Verificar que ningún comprobante tenga otra CDB en curso (PENDIENTE/ENVIADO/ACEPTADO)
    const bajasEnCurso = await this.prisma.detalleComunicacionBaja.findMany({
      where: {
        comprobanteId: { in: ids },
        comunicacionBaja: {
          estadoSunat: { in: ['PENDIENTE', 'ACEPTADO'] as any },
        },
      },
      select: {
        comprobante: { select: { codigoGenerado: true } },
      },
    });
    if (bajasEnCurso.length > 0) {
      const codigos = bajasEnCurso.map((b) => b.comprobante.codigoGenerado).join(', ');
      throw new BadRequestException(`Los siguientes comprobantes ya tienen una baja en curso: ${codigos}`);
    }

    // 5. Resolver config del proveedor + validar que admita CDB
    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, dto.sedeId);
    if (!config.facturacionActiva) {
      throw new BadRequestException('La facturación no está activa para esta sede');
    }
    if (this.providerFactory.isArchivado(config.proveedorActivo)) {
      throw new BadRequestException(this.providerFactory.mensajeArchivado(config.proveedorActivo));
    }
    const provider = this.providerFactory.get(config.proveedorActivo);
    if (typeof provider.crearComunicacionBaja !== 'function') {
      throw new BadRequestException(
        `Proveedor ${config.proveedorActivo} no soporta Comunicaciones de Baja vía API`,
      );
    }

    // 6. Llamar al proveedor para crear la CDB (no la envía a SUNAT aún)
    const input: ComunicacionBajaInput = {
      fechaReferencia: dto.fechaReferencia,
      motivoBaja: dto.motivoBaja,
      detalles: dto.detalles.map((d) => {
        const c = mapaComp.get(d.comprobanteId)!;
        return {
          tipoDocumento: TIPO_INTERNO_A_SUNAT[c.tipoComprobante],
          serie: c.serie,
          correlativo: c.correlativo,
          motivoEspecifico: d.motivoEspecifico,
        };
      }),
      usuarioCreacion: dto.usuarioCreacion ?? userId ?? undefined,
    };

    let respProveedor: ComunicacionBajaResult;
    try {
      respProveedor = await provider.crearComunicacionBaja(input, config as any);
    } catch (err: any) {
      this.logger.error(`Error creando CDB en proveedor: ${err?.message}`);
      throw new BadRequestException(`Proveedor rechazó la creación: ${err?.message ?? err}`);
    }

    // 7. Persistir local con sus detalles
    const baja = await this.prisma.comunicacionBaja.create({
      data: {
        empresaId,
        sedeId: dto.sedeId,
        numeroCompleto: respProveedor.numeroCompleto,
        serie: respProveedor.serie,
        correlativo: respProveedor.correlativo,
        fechaEmision: respProveedor.fechaEmision
          ? new Date(respProveedor.fechaEmision)
          : new Date(),
        fechaReferencia: fechaRef,
        motivoBaja: dto.motivoBaja,
        estadoSunat: this.mapEstado(respProveedor.estadoSunat),
        proveedorEmisor: config.proveedorActivo,
        proveedorBajaId: respProveedor.proveedorBajaId,
        usuarioCreacionId: userId,
        cdrResponse: respProveedor.rawResponse as Prisma.InputJsonValue,
        detalles: {
          createMany: {
            data: dto.detalles.map((d) => ({
              comprobanteId: d.comprobanteId,
              motivoEspecifico: d.motivoEspecifico,
            })),
          },
        },
      },
      include: { detalles: true },
    });

    // 8. Fire-after-commit: enviar a SUNAT
    this.enviar(baja.id, empresaId).catch((err) =>
      this.logger.warn(`Envío CDB fallido: ${err?.message}`),
    );

    return baja;
  }

  /**
   * Envía a SUNAT una CDB previamente creada localmente.
   */
  async enviar(id: string, empresaId: string) {
    const baja = await this.prisma.comunicacionBaja.findFirst({
      where: { id, empresaId },
    });
    if (!baja) throw new NotFoundException('Comunicación de baja no encontrada');
    if (!baja.proveedorBajaId) {
      throw new BadRequestException('La CDB no tiene proveedorBajaId — no fue creada en el proveedor');
    }
    if (baja.estadoSunat === 'ACEPTADO') {
      return baja;
    }

    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, baja.sedeId);
    const provider = this.providerFactory.get(baja.proveedorEmisor);
    if (typeof provider.enviarComunicacionBaja !== 'function') {
      throw new BadRequestException(`Proveedor ${baja.proveedorEmisor} no soporta envío de CDB`);
    }

    let resp: ComunicacionBajaResult;
    try {
      resp = await provider.enviarComunicacionBaja(baja.proveedorBajaId, config as any);
    } catch (err: any) {
      await this.prisma.comunicacionBaja.update({
        where: { id },
        data: {
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
          errorProveedor: String(err?.message ?? err).slice(0, 1000),
        },
      });
      throw new BadRequestException(`Error enviando CDB a SUNAT: ${err?.message ?? err}`);
    }

    return this.aplicarEstado(id, resp);
  }

  /**
   * Re-consulta el estado de una CDB que quedó en ENVIADO.
   */
  async consultar(id: string, empresaId: string) {
    const baja = await this.prisma.comunicacionBaja.findFirst({
      where: { id, empresaId },
    });
    if (!baja) throw new NotFoundException('Comunicación de baja no encontrada');
    if (!baja.proveedorBajaId) {
      throw new BadRequestException('La CDB no tiene proveedorBajaId');
    }

    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, baja.sedeId);
    const provider = this.providerFactory.get(baja.proveedorEmisor);
    if (typeof provider.consultarComunicacionBaja !== 'function') {
      throw new BadRequestException(`Proveedor ${baja.proveedorEmisor} no soporta consulta de CDB`);
    }

    const resp = await provider.consultarComunicacionBaja(baja.proveedorBajaId, config as any);
    return this.aplicarEstado(id, resp);
  }

  async listar(
    empresaId: string,
    filtros: { estadoSunat?: string; fechaDesde?: string; fechaHasta?: string; page?: number; limit?: number },
  ) {
    const where: any = { empresaId };
    if (filtros.estadoSunat) where.estadoSunat = filtros.estadoSunat;
    if (filtros.fechaDesde || filtros.fechaHasta) {
      where.fechaEmision = {};
      if (filtros.fechaDesde) where.fechaEmision.gte = new Date(`${filtros.fechaDesde}T00:00:00`);
      if (filtros.fechaHasta) where.fechaEmision.lte = new Date(`${filtros.fechaHasta}T23:59:59.999`);
    }
    const page = filtros.page ?? 1;
    const limit = filtros.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.comunicacionBaja.findMany({
        where,
        include: {
          detalles: {
            include: {
              comprobante: { select: { id: true, codigoGenerado: true, tipoComprobante: true } },
            },
          },
        },
        orderBy: { fechaEmision: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.comunicacionBaja.count({ where }),
    ]);
    return { data, total, totalPages: Math.ceil(total / limit), page };
  }

  async obtenerPorId(id: string, empresaId: string) {
    const baja = await this.prisma.comunicacionBaja.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: {
            comprobante: {
              select: { id: true, codigoGenerado: true, tipoComprobante: true, total: true, anulado: true },
            },
          },
        },
      },
    });
    if (!baja) throw new NotFoundException('Comunicación de baja no encontrada');
    return baja;
  }

  /**
   * Lista comprobantes elegibles para anular vía CDB en una fecha dada.
   * Aplica las restricciones SUNAT localmente (sin consultar al proveedor).
   */
  async obtenerElegibles(empresaId: string, sedeId: string, fechaReferencia: string) {
    const fechaRef = new Date(`${fechaReferencia}T00:00:00`);
    if (Number.isNaN(fechaRef.getTime())) {
      throw new BadRequestException(`fechaReferencia inválida: ${fechaReferencia}`);
    }
    const inicio = new Date(fechaRef);
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date(fechaRef);
    fin.setHours(23, 59, 59, 999);

    const comprobantes = await this.prisma.comprobanteElectronico.findMany({
      where: {
        empresaId,
        sedeId,
        sunatStatus: 'ACEPTADO',
        anulado: false,
        tipoComprobante: { in: ['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO'] },
        // Solo NC/ND con prefijo F (FC*/FD*); FACTURA siempre cumple
        OR: [
          { tipoComprobante: 'FACTURA' },
          { tipoComprobante: 'NOTA_CREDITO', serie: { startsWith: 'F' } },
          { tipoComprobante: 'NOTA_DEBITO', serie: { startsWith: 'F' } },
        ],
        fechaEmision: { gte: inicio, lte: fin },
      },
      select: {
        id: true,
        codigoGenerado: true,
        tipoComprobante: true,
        serie: true,
        correlativo: true,
        nombreCliente: true,
        numeroDocumento: true,
        fechaEmision: true,
        total: true,
        moneda: true,
        notasRelacionadas: {
          where: { sunatStatus: 'ACEPTADO', anulado: false },
          select: { id: true },
        },
        bajas: {
          where: {
            comunicacionBaja: {
              estadoSunat: { in: ['PENDIENTE', 'ACEPTADO'] as any },
            },
          },
          select: { id: true },
        },
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // Anotar elegibilidad
    return comprobantes.map((c) => {
      const tieneNotas = c.notasRelacionadas.length > 0;
      const tieneBaja = c.bajas.length > 0;
      const elegible =
        !tieneBaja && !(c.tipoComprobante === 'FACTURA' && tieneNotas);
      const motivoNoElegible = tieneBaja
        ? 'Ya tiene una CDB en curso o aceptada'
        : tieneNotas && c.tipoComprobante === 'FACTURA'
        ? 'Factura con notas aceptadas asociadas'
        : null;
      return {
        ...c,
        notasRelacionadas: undefined,
        bajas: undefined,
        elegible,
        motivoNoElegible,
      };
    });
  }

  /**
   * Aplica un resultado del proveedor a la BD. Si la CDB queda ACEPTADO,
   * marca todos los comprobantes referenciados como anulado=true.
   */
  private async aplicarEstado(id: string, resp: ComunicacionBajaResult) {
    const estado = this.mapEstado(resp.estadoSunat);
    const updated = await this.prisma.$transaction(async (tx) => {
      const baja = await tx.comunicacionBaja.update({
        where: { id },
        data: {
          estadoSunat: estado,
          ticket: resp.ticket ?? undefined,
          hashCdr: resp.hashCdr ?? undefined,
          errorProveedor: resp.errorProveedor ?? undefined,
          sunatXmlUrl: resp.xmlUrl ?? undefined,
          sunatCdrUrl: resp.cdrUrl ?? undefined,
          enviadoAProveedor: true,
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
          cdrResponse: resp.rawResponse as Prisma.InputJsonValue,
        },
        include: { detalles: true },
      });

      if (estado === 'ACEPTADO') {
        const ids = baja.detalles.map((d) => d.comprobanteId);
        await tx.comprobanteElectronico.updateMany({
          where: { id: { in: ids } },
          data: { anulado: true, motivoAnulacion: baja.motivoBaja },
        });
      }
      return baja;
    });
    return updated;
  }

  private mapEstado(estadoProv: string): any {
    const e = (estadoProv ?? '').toUpperCase();
    if (e === 'ACEPTADO') return 'ACEPTADO';
    if (e === 'RECHAZADO') return 'RECHAZADO';
    if (e === 'ENVIADO' || e === 'PROCESANDO' || e === 'EN_COLA') return 'PROCESANDO';
    return 'PENDIENTE';
  }
}
