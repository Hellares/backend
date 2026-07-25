import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { FacturacionService } from './facturacion.service';
import { FacturacionProviderFactory } from './providers/facturacion-provider.factory';
import { CrearResumenDiarioDto } from './dto/resumen-diario.dto';
import {
  ResumenDiarioInput,
  ResumenDiarioResult,
} from './facturacion-provider.interface';
import { Prisma } from '@prisma/client';

// Por ahora solo BOLETA. Notas `BC` / `BD` requerirían endpoint distinto en Syncrofact.
const TIPOS_PERMITIDOS_RC = new Set(['BOLETA']);
const PLAZO_DIAS_RC = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

@Injectable()
export class ResumenDiarioService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: FacturacionProviderFactory,
    private readonly facturacionService: FacturacionService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('ResumenDiarioService');
  }

  /**
   * Crea un Resumen Diario localmente y en el proveedor.
   * NO lo envía a SUNAT — eso se hace con `enviar()` después.
   */
  async crear(empresaId: string, dto: CrearResumenDiarioDto, userId?: string) {
    if (!dto.detalles?.length) {
      throw new BadRequestException('El RC debe incluir al menos 1 boleta');
    }

    // 1. Validar sede pertenece a la empresa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId },
      select: { id: true },
    });
    if (!sede) throw new BadRequestException('Sede no encontrada o no pertenece a la empresa');

    // 2. Cargar y validar cada comprobante (boleta)
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
        rucEmisor: true,
        fechaEmision: true,
        cdrResponse: true,
      },
    });

    const mapaComp = new Map(comprobantes.map((c) => [c.id, c]));

    // Multi-RUC: el RC se envía con credenciales del emisor PRINCIPAL —
    // boletas de un emisor socio no pueden entrar (irían a otra company).
    const empresaRc = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ruc: true },
    });
    const rucPrincipal = empresaRc?.ruc ?? null;

    const errores: string[] = [];
    let proveedorRef: string | null = null;
    let fechaEmisionRef: Date | null = null;

    for (const detalle of dto.detalles) {
      const c = mapaComp.get(detalle.comprobanteId);
      if (!c) {
        errores.push(`Comprobante ${detalle.comprobanteId} no encontrado en la empresa`);
        continue;
      }
      if (!TIPOS_PERMITIDOS_RC.has(c.tipoComprobante)) {
        errores.push(
          `${c.codigoGenerado}: tipo ${c.tipoComprobante} no admite Resumen Diario (use Comunicación de Baja para Facturas/NC-FC/ND-FD)`,
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
      if (c.rucEmisor && rucPrincipal && c.rucEmisor !== rucPrincipal) {
        errores.push(
          `${c.codigoGenerado}: emitido con RUC ${c.rucEmisor} (emisor socio). ` +
          `El RC solo soporta el emisor principal por ahora — anúlala con Nota de Crédito.`,
        );
        continue;
      }
      // Plazo 3 días desde fechaEmision
      const dias = Math.floor(
        (Date.now() - new Date(c.fechaEmision).getTime()) / MS_PER_DAY,
      );
      if (dias > PLAZO_DIAS_RC) {
        errores.push(
          `${c.codigoGenerado}: tiene ${dias} días desde emisión. Plazo SUNAT: ${PLAZO_DIAS_RC} días.`,
        );
        continue;
      }
      // Misma fecha de emisión para todo el lote (regla SUNAT)
      const fechaCmp = this.fechaSoloFecha(c.fechaEmision);
      if (fechaEmisionRef === null) {
        fechaEmisionRef = fechaCmp;
      } else if (fechaCmp.getTime() !== fechaEmisionRef.getTime()) {
        errores.push(
          `${c.codigoGenerado}: fecha emisión ${fechaCmp.toISOString().slice(0, 10)} difiere del lote (${fechaEmisionRef.toISOString().slice(0, 10)}). Hacer un RC por fecha.`,
        );
        continue;
      }
      // Mismo proveedor
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
    if (!fechaEmisionRef) {
      throw new BadRequestException('No se pudo determinar la fecha de emisión del lote');
    }

    // 3. Verificar que ningún comprobante tenga otro RC en curso (PENDIENTE/ACEPTADO)
    const ids = dto.detalles.map((d) => d.comprobanteId);
    const enCurso = await this.prisma.detalleResumenDiario.findMany({
      where: {
        comprobanteId: { in: ids },
        resumenDiario: {
          estadoSunat: { in: ['PENDIENTE', 'ACEPTADO'] as any },
        },
      },
      select: {
        comprobante: { select: { codigoGenerado: true } },
      },
    });
    if (enCurso.length > 0) {
      const codigos = enCurso.map((b) => b.comprobante.codigoGenerado).join(', ');
      throw new BadRequestException(`Las siguientes boletas ya tienen un RC en curso: ${codigos}`);
    }

    // 4. Resolver config del proveedor + validar que admita RC
    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, dto.sedeId);
    if (!config.facturacionActiva) {
      throw new BadRequestException('La facturación no está activa para esta sede');
    }
    if (this.providerFactory.isArchivado(config.proveedorActivo)) {
      throw new BadRequestException(this.providerFactory.mensajeArchivado(config.proveedorActivo));
    }
    const provider = this.providerFactory.get(config.proveedorActivo);
    if (typeof provider.crearResumenDiario !== 'function') {
      throw new BadRequestException(
        `Proveedor ${config.proveedorActivo} no soporta Resumen Diario vía API`,
      );
    }

    // 5. Mapear boletas a IDs del proveedor (Syncrofact: cdrResponse._syncrofactId).
    // Si el cdrResponse no tiene el id (boletas emitidas con la rama PROCESANDO
    // antigua que no lo persistía), consultamos al proveedor por referencia_interna
    // y backfilleamos el cdrResponse para que la próxima vez funcione directo.
    const detallesProv: Array<{ proveedorComprobanteId: string; motivoEspecifico: string }> = [];
    for (const d of dto.detalles) {
      const c = mapaComp.get(d.comprobanteId)!;
      let provId = this.extraerProveedorId(c.cdrResponse);
      if (!provId) {
        provId = await this.recuperarProveedorIdYBackfill(
          c.id,
          c.codigoGenerado,
          c.tipoComprobante,
          c.cdrResponse,
          config,
        );
      }
      if (!provId) {
        throw new BadRequestException(
          `Boleta ${c.codigoGenerado} no se encuentra en el proveedor por referencia_interna. No se puede anular.`,
        );
      }
      detallesProv.push({
        proveedorComprobanteId: provId,
        motivoEspecifico: d.motivoEspecifico,
      });
    }

    this.logger.info(
      `Creando RC en ${config.proveedorActivo} para ${dto.detalles.length} boleta(s) (sede ${dto.sedeId}, fechaRef ${fechaEmisionRef.toISOString().slice(0, 10)})`,
    );

    const input: ResumenDiarioInput = {
      motivoAnulacion: dto.motivoAnulacion,
      detalles: detallesProv,
      usuarioCreacion: dto.usuarioCreacion ?? userId ?? undefined,
    };

    let respProveedor: ResumenDiarioResult;
    try {
      respProveedor = await provider.crearResumenDiario!(input, config as any);
    } catch (err: any) {
      this.logger.error(`Error creando RC en proveedor: ${err?.message}`);
      throw new BadRequestException(`Proveedor rechazó la creación: ${err?.message ?? err}`);
    }

    this.logger.info(
      `RC ${respProveedor.numeroCompleto} creado en ${config.proveedorActivo} (proveedorResumenId=${respProveedor.proveedorResumenId})`,
    );

    // 6. Persistir local con sus detalles
    const resumen = await this.prisma.resumenDiario.create({
      data: {
        empresaId,
        sedeId: dto.sedeId,
        numeroCompleto: respProveedor.numeroCompleto,
        serie: respProveedor.serie,
        correlativo: respProveedor.correlativo,
        fechaEmision: respProveedor.fechaEmision
          ? new Date(respProveedor.fechaEmision)
          : new Date(),
        fechaReferencia: fechaEmisionRef,
        motivoAnulacion: dto.motivoAnulacion,
        estadoSunat: this.mapEstado(respProveedor.estadoSunat),
        proveedorEmisor: config.proveedorActivo,
        proveedorResumenId: respProveedor.proveedorResumenId,
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

    // 7. Fire-after-commit: enviar a SUNAT
    this.enviar(resumen.id, empresaId).catch((err) =>
      this.logger.warn(`Envío RC fallido: ${err?.message}`),
    );

    return resumen;
  }

  /**
   * Envía a SUNAT un RC previamente creado localmente.
   */
  async enviar(id: string, empresaId: string) {
    const resumen = await this.prisma.resumenDiario.findFirst({
      where: { id, empresaId },
    });
    if (!resumen) throw new NotFoundException('RC no encontrado');
    if (!resumen.proveedorResumenId) {
      throw new BadRequestException('El RC no tiene proveedorResumenId — no fue creado en el proveedor');
    }
    if (resumen.estadoSunat === 'ACEPTADO') {
      return resumen;
    }

    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, resumen.sedeId);
    const provider = this.providerFactory.get(resumen.proveedorEmisor);
    if (typeof provider.enviarResumenDiario !== 'function') {
      throw new BadRequestException(`Proveedor ${resumen.proveedorEmisor} no soporta envío de RC`);
    }

    this.logger.info(`Enviando RC ${resumen.numeroCompleto} a SUNAT vía ${resumen.proveedorEmisor}`);

    let resp: ResumenDiarioResult;
    try {
      resp = await provider.enviarResumenDiario!(resumen.proveedorResumenId, config as any);
    } catch (err: any) {
      await this.prisma.resumenDiario.update({
        where: { id },
        data: {
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
          errorProveedor: String(err?.message ?? err).slice(0, 1000),
        },
      });
      this.logger.error(`Error enviando RC ${resumen.numeroCompleto} a SUNAT: ${err?.message ?? err}`);
      throw new BadRequestException(`Error enviando RC a SUNAT: ${err?.message ?? err}`);
    }

    this.logger.info(
      `RC ${resumen.numeroCompleto} enviado, pendiente confirmación SUNAT (ticket=${resp.ticket ?? '—'})`,
    );

    return this.aplicarEstado(id, resp);
  }

  /**
   * Re-consulta el estado de un RC que quedó en PROCESANDO.
   */
  async consultar(id: string, empresaId: string) {
    const resumen = await this.prisma.resumenDiario.findFirst({
      where: { id, empresaId },
    });
    if (!resumen) throw new NotFoundException('RC no encontrado');
    if (!resumen.proveedorResumenId) {
      throw new BadRequestException('El RC no tiene proveedorResumenId');
    }

    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, resumen.sedeId);
    const provider = this.providerFactory.get(resumen.proveedorEmisor);
    if (typeof provider.consultarResumenDiario !== 'function') {
      throw new BadRequestException(`Proveedor ${resumen.proveedorEmisor} no soporta consulta de RC`);
    }

    this.logger.info(`Re-consultando estado de RC ${resumen.numeroCompleto} en ${resumen.proveedorEmisor}`);
    const resp = await provider.consultarResumenDiario!(resumen.proveedorResumenId, config as any);
    this.logger.info(`RC ${resumen.numeroCompleto} consulta SUNAT → ${resp.estadoSunat ?? '—'}`);
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
      this.prisma.resumenDiario.findMany({
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
      this.prisma.resumenDiario.count({ where }),
    ]);
    return { data, total, totalPages: Math.ceil(total / limit), page };
  }

  async obtenerPorId(id: string, empresaId: string) {
    const resumen = await this.prisma.resumenDiario.findFirst({
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
    if (!resumen) throw new NotFoundException('RC no encontrado');
    return resumen;
  }

  /**
   * Lista boletas elegibles para anular vía RC en una fecha dada.
   * Plazo 3 días, ACEPTADO, no anulado, sin RC en curso.
   */
  async obtenerElegibles(empresaId: string, sedeId: string, fechaReferencia: string) {
    const fechaRef = new Date(`${fechaReferencia}T00:00:00`);
    if (Number.isNaN(fechaRef.getTime())) {
      throw new BadRequestException(`fechaReferencia inválida: ${fechaReferencia}`);
    }
    // Validar que esté dentro del plazo 3 días
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const dias = Math.floor((hoy.getTime() - fechaRef.getTime()) / MS_PER_DAY);
    if (dias < 0) {
      throw new BadRequestException('fechaReferencia no puede ser futura');
    }
    if (dias > PLAZO_DIAS_RC) {
      throw new BadRequestException(
        `fechaReferencia tiene ${dias} días. Plazo SUNAT: ${PLAZO_DIAS_RC} días.`,
      );
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
        tipoComprobante: 'BOLETA',
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
        resumenes: {
          where: {
            resumenDiario: {
              estadoSunat: { in: ['PENDIENTE', 'ACEPTADO'] as any },
            },
          },
          select: { id: true },
        },
      },
      orderBy: { fechaEmision: 'asc' },
    });

    return comprobantes.map((c) => {
      const tieneRC = c.resumenes.length > 0;
      return {
        ...c,
        resumenes: undefined,
        elegible: !tieneRC,
        motivoNoElegible: tieneRC ? 'Ya tiene un RC en curso o aceptado' : null,
      };
    });
  }

  /**
   * Aplica un resultado del proveedor a la BD. Si el RC queda ACEPTADO,
   * marca todas las boletas referenciadas como anulado=true.
   */
  private async aplicarEstado(id: string, resp: ResumenDiarioResult) {
    const estado = this.mapEstado(resp.estadoSunat);
    const updated = await this.prisma.$transaction(async (tx) => {
      const resumen = await tx.resumenDiario.update({
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
        const ids = resumen.detalles.map((d) => d.comprobanteId);
        await tx.comprobanteElectronico.updateMany({
          where: { id: { in: ids } },
          data: { anulado: true, motivoAnulacion: resumen.motivoAnulacion },
        });
      }
      return resumen;
    });
    this.logger.info(
      `RC ${updated.numeroCompleto} estado actualizado → ${estado}` +
      (estado === 'ACEPTADO' ? ` (${updated.detalles.length} boleta(s) marcadas anuladas)` : ''),
    );
    return updated;
  }

  private mapEstado(estadoProv: string): any {
    const e = (estadoProv ?? '').toUpperCase();
    if (e === 'ACEPTADO') return 'ACEPTADO';
    if (e === 'RECHAZADO') return 'RECHAZADO';
    if (e === 'ENVIADO' || e === 'PROCESANDO' || e === 'EN_COLA') return 'PROCESANDO';
    return 'PENDIENTE';
  }

  /** Trunca timestamp a YYYY-MM-DD para comparar solo fecha. */
  private fechaSoloFecha(d: Date | string): Date {
    const dt = new Date(d);
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }

  /**
   * Cuando cdrResponse no tiene `_syncrofactId` (boleta emitida con la rama
   * PROCESANDO antigua), consulta el proveedor por `referencia_interna` y
   * backfillea cdrResponse en BD para que el próximo intento funcione directo.
   */
  private async recuperarProveedorIdYBackfill(
    comprobanteId: string,
    codigoGenerado: string,
    tipoComprobante: string,
    cdrResponseActual: any,
    config: any,
  ): Promise<string | null> {
    const provider = this.providerFactory.get(config.proveedorActivo) as any;
    if (typeof provider.resolverProveedorIdPorReferencia !== 'function') {
      this.logger.warn(
        `Proveedor ${config.proveedorActivo} no soporta lookup por referencia_interna; no se puede recuperar id de ${codigoGenerado}.`,
      );
      return null;
    }
    this.logger.info(
      `Boleta ${codigoGenerado} sin _syncrofactId en BD; consultando proveedor por referencia_interna...`,
    );
    const provId: string | null = await provider.resolverProveedorIdPorReferencia(
      comprobanteId,
      tipoComprobante,
      config,
    );
    if (!provId) return null;

    // Backfill cdrResponse preservando lo que ya hubiera.
    const merged = {
      ...(cdrResponseActual ?? {}),
      _syncrofactId: Number(provId),
      _backfilledAt: new Date().toISOString(),
    };
    try {
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobanteId },
        data: { cdrResponse: merged as Prisma.InputJsonValue },
      });
      this.logger.info(`Boleta ${codigoGenerado}: cdrResponse backfilled con _syncrofactId=${provId}.`);
    } catch (err: any) {
      this.logger.warn(`No se pudo backfillar cdrResponse de ${codigoGenerado}: ${err?.message ?? err}`);
    }
    return provId;
  }

  /** Extrae el ID del proveedor (Syncrofact) desde cdrResponse. */
  private extraerProveedorId(cdrResponse: any): string | null {
    if (!cdrResponse) return null;
    if (typeof cdrResponse._syncrofactId === 'number') return String(cdrResponse._syncrofactId);
    if (cdrResponse.data?.id && typeof cdrResponse.data.id === 'number') {
      return String(cdrResponse.data.id);
    }
    return null;
  }
}
