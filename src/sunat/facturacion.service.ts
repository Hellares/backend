import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditService } from '../audit/audit.service';
import { FacturacionProvider, FACTURACION_PROVIDER, EnvioResult } from './facturacion-provider.interface';
import {
  ENVIO_BATCH_SIZE,
  MAX_FALTANTES_REPORTE,
  MAX_INTENTOS_ENVIO,
} from './providers/nubefact.types';
import { CrearNotaDto } from './dto/crear-nota.dto';
import { ConfiguracionFacturacionDto } from './dto/configuracion-facturacion.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class FacturacionService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(FACTURACION_PROVIDER) private readonly provider: FacturacionProvider,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('FacturacionService');
  }

  // ── Config efectiva: Sede > ConfiguracionFacturacion > Empresa ──

  /**
   * Fuente única de datos de facturación.
   *
   * Prioridad por campo:
   * - RUC, razónSocial, direcciónFiscal → Sede (override) > Empresa (fuente primaria)
   * - nombreComercial → ConfigDocumentos (marca/visual) > Empresa.nombre
   * - logo → ConfigDocumentos.logoUrl > Empresa.logo
   * - teléfono, email → Sede > Empresa
   * - Proveedor facturación → Sede > ConfigFacturacion
   * - IGV, entorno, resolucion → ConfigFacturacion (billing-only)
   * - textoPiePagina → ConfigFacturacion
   */
  async getConfigFacturacionEfectiva(empresaId: string, sedeId?: string | null) {
    const [config, sede, empresa, configDoc] = await Promise.all([
      this.prisma.configuracionFacturacion.findUnique({
        where: { empresaId },
        select: {
          proveedorRuta: true, proveedorToken: true, facturacionActiva: true,
          entorno: true, porcentajeIGV: true, resolucionSunat: true,
          emailFacturacion: true, textoPiePagina: true,
        },
      }),
      sedeId
        ? this.prisma.sede.findFirst({
            where: { id: sedeId, empresaId },
            select: {
              rucSede: true, razonSocialSede: true, direccionFiscalSede: true,
              proveedorRuta: true, proveedorToken: true, facturacionActiva: true,
              resolucionSunat: true, telefono: true, email: true,
            },
          })
        : null,
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          ruc: true, razonSocial: true, nombre: true,
          direccionFiscal: true, telefono: true, email: true, logo: true,
        },
      }),
      this.prisma.configuracionDocumentos.findFirst({
        where: { empresaId },
        select: { nombreComercial: true, logoUrl: true },
      }),
    ]);

    return {
      // Identidad fiscal: Sede override > Empresa (fuente primaria)
      ruc:              sede?.rucSede              ?? empresa?.ruc            ?? null,
      razonSocial:      sede?.razonSocialSede      ?? empresa?.razonSocial   ?? null,
      direccionFiscal:  sede?.direccionFiscalSede   ?? empresa?.direccionFiscal ?? null,
      // Marca: ConfigDocumentos > Empresa.nombre
      nombreComercial:  configDoc?.nombreComercial  ?? empresa?.nombre        ?? null,
      // Logo: ConfigDocumentos > Empresa
      logo:             configDoc?.logoUrl          ?? empresa?.logo          ?? null,
      // Contacto: Sede > Empresa
      telefono:         sede?.telefono              ?? empresa?.telefono      ?? null,
      email:            sede?.email                 ?? empresa?.email         ?? null,
      emailFacturacion: config?.emailFacturacion    ?? sede?.email            ?? empresa?.email ?? null,
      // Proveedor: Sede > ConfigFacturacion
      proveedorRuta:     sede?.proveedorRuta          ?? config?.proveedorRuta   ?? null,
      proveedorToken:    sede?.proveedorToken         ?? config?.proveedorToken  ?? null,
      facturacionActiva:   sede?.facturacionActiva        ?? config?.facturacionActiva ?? false,
      // Billing-only: ConfigFacturacion
      resolucionSunat:  sede?.resolucionSunat       ?? config?.resolucionSunat ?? null,
      entorno:          config?.entorno             ?? 'BETA',
      porcentajeIGV:    Number(config?.porcentajeIGV ?? 18),
      textoPiePagina:   config?.textoPiePagina      ?? 'Gracias por su compra',
    };
  }

  // ── Emisores: listar RUCs disponibles ──

  async listarEmisores(empresaId: string) {
    const [config, empresa, sedes] = await Promise.all([
      this.prisma.configuracionFacturacion.findUnique({
        where: { empresaId },
        select: { facturacionActiva: true },
      }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { ruc: true, razonSocial: true, nombre: true },
      }),
      this.prisma.sede.findMany({
        where: { empresaId, rucSede: { not: null }, isActive: true },
        select: { id: true, nombre: true, rucSede: true, razonSocialSede: true, facturacionActiva: true },
      }),
    ]);

    const emisores: Array<{
      id: string | null;
      tipo: 'EMPRESA' | 'SEDE';
      ruc: string;
      razonSocial: string;
      nombreComercial: string | null;
      sedeNombre: string | null;
      activo: boolean;
    }> = [];

    // Emisor principal (empresa — fuente de verdad para RUC)
    if (empresa?.ruc) {
      emisores.push({
        id: null,
        tipo: 'EMPRESA',
        ruc: empresa.ruc,
        razonSocial: empresa.razonSocial || empresa.nombre || '',
        nombreComercial: empresa.nombre || null,
        sedeNombre: null,
        activo: config?.facturacionActiva ?? false,
      });
    }

    // Emisores por sede (con RUC propio)
    for (const sede of sedes) {
      emisores.push({
        id: sede.id,
        tipo: 'SEDE',
        ruc: sede.rucSede!,
        razonSocial: sede.razonSocialSede || '',
        nombreComercial: null,
        sedeNombre: sede.nombre,
        activo: sede.facturacionActiva ?? false,
      });
    }

    return emisores;
  }

  // ── Reporte de Correlativos ──

  async reporteCorrelativos(empresaId: string, sedeId?: string, fechaDesde?: string, fechaHasta?: string) {
    const sedeWhere: any = { empresaId, isActive: true };
    if (sedeId) sedeWhere.id = sedeId;

    const compWhere: any = { empresaId, ...(sedeId ? { sedeId } : {}) };
    if (fechaDesde || fechaHasta) {
      compWhere.fechaEmision = {};
      if (fechaDesde) compWhere.fechaEmision.gte = new Date(`${fechaDesde}T00:00:00`);
      if (fechaHasta) compWhere.fechaEmision.lte = new Date(`${fechaHasta}T23:59:59.999`);
    }

    const [sedes, comprobantes] = await Promise.all([
      this.prisma.sede.findMany({
        where: sedeWhere,
        select: {
          id: true, nombre: true,
          serieFactura: true, serieBoleta: true,
          serieNotaCredito: true, serieNotaDebito: true,
          ultimoNumeroFactura: true, ultimoNumeroBoleta: true,
          ultimoNumeroNotaCredito: true, ultimoNumeroNotaDebito: true,
        },
      }),
      this.prisma.comprobanteElectronico.findMany({
        where: compWhere,
        select: {
          serie: true, correlativo: true, tipoComprobante: true,
          estado: true, anulado: true, sedeId: true,
        },
        orderBy: [{ serie: 'asc' }, { correlativo: 'asc' }],
      }),
    ]);

    // Agrupar comprobantes por serie
    // Agrupar por serie (cada serie pertenece a una sola sede por ley SUNAT)
    const porSerie = new Map<string, {
      tipo: string;
      sedeId: string | null;
      items: { correlativo: number; anulado: boolean }[];
    }>();

    for (const c of comprobantes) {
      if (!porSerie.has(c.serie)) {
        porSerie.set(c.serie, { tipo: c.tipoComprobante, sedeId: c.sedeId, items: [] });
      }
      porSerie.get(c.serie)!.items.push({
        correlativo: parseInt(c.correlativo, 10),
        anulado: c.anulado,
      });
    }

    const series: any[] = [];

    for (const [serie, { tipo, sedeId: compSedeId, items }] of porSerie) {
      items.sort((a, b) => a.correlativo - b.correlativo);
      const correlativoSet = new Set(items.map(i => i.correlativo));
      const min = items[0].correlativo;
      const max = items[items.length - 1].correlativo;

      // Detectar gaps entre el primer y último correlativo encontrado (no desde 1)
      const faltantes: number[] = [];
      for (let i = min; i <= max; i++) {
        if (!correlativoSet.has(i)) faltantes.push(i);
      }

      // Detectar duplicados
      const duplicados = items.length - correlativoSet.size;

      // Buscar sede por sedeId del comprobante, fallback por nombre de serie
      let sede = compSedeId ? sedes.find(s => s.id === compSedeId) : null;
      if (!sede) {
        sede = sedes.find(s => {
          switch (tipo) {
            case 'FACTURA': return s.serieFactura === serie;
            case 'BOLETA': return s.serieBoleta === serie;
            case 'NOTA_CREDITO': return s.serieNotaCredito === serie;
            case 'NOTA_DEBITO': return s.serieNotaDebito === serie;
            default: return false;
          }
        }) || sedes[0] || null;
      }

      let contadorSede = 0;
      if (sede) {
        switch (tipo) {
          case 'FACTURA': contadorSede = sede.ultimoNumeroFactura; break;
          case 'BOLETA': contadorSede = sede.ultimoNumeroBoleta; break;
          case 'NOTA_CREDITO': contadorSede = sede.ultimoNumeroNotaCredito; break;
          case 'NOTA_DEBITO': contadorSede = sede.ultimoNumeroNotaDebito; break;
        }
      }

      const desincronizado = contadorSede !== max;
      const anulados = items.filter(i => i.anulado).length;
      const hayGaps = faltantes.length > 0;

      let estado = 'OK';
      if (desincronizado && hayGaps) estado = 'DESINCRONIZADO';
      else if (desincronizado) estado = 'DESINCRONIZADO';
      else if (hayGaps) estado = 'GAPS';

      series.push({
        serie,
        tipoComprobante: tipo,
        sedeId: compSedeId || sede?.id || null,
        sedeNombre: sede?.nombre || 'Principal',
        primerCorrelativo: min,
        ultimoCorrelativo: max,
        contadorSede,
        totalEmitidos: items.length,
        totalAnulados: anulados,
        duplicados,
        faltantes: faltantes.slice(0, MAX_FALTANTES_REPORTE),
        totalFaltantes: faltantes.length,
        desincronizado,
        estado,
      });
    }

    // Agregar series de sedes con contador > 0 pero sin comprobantes
    for (const sede of sedes) {
      const checks = [
        { serie: sede.serieFactura, tipo: 'FACTURA', contador: sede.ultimoNumeroFactura },
        { serie: sede.serieBoleta, tipo: 'BOLETA', contador: sede.ultimoNumeroBoleta },
        { serie: sede.serieNotaCredito, tipo: 'NOTA_CREDITO', contador: sede.ultimoNumeroNotaCredito },
        { serie: sede.serieNotaDebito, tipo: 'NOTA_DEBITO', contador: sede.ultimoNumeroNotaDebito },
      ];
      for (const ch of checks) {
        if (ch.contador > 0 && !porSerie.has(ch.serie)) {
          series.push({
            serie: ch.serie, tipoComprobante: ch.tipo,
            sedeId: sede.id, sedeNombre: sede.nombre,
            primerCorrelativo: 0, ultimoCorrelativo: 0,
            contadorSede: ch.contador,
            totalEmitidos: 0, totalAnulados: 0, duplicados: 0,
            faltantes: [], totalFaltantes: 0,
            desincronizado: true, estado: 'DESINCRONIZADO',
          });
        }
      }
    }

    // Ordenar por tipo y serie
    const tipoOrder: Record<string, number> = { FACTURA: 0, BOLETA: 1, NOTA_CREDITO: 2, NOTA_DEBITO: 3 };
    series.sort((a, b) => (tipoOrder[a.tipoComprobante] ?? 99) - (tipoOrder[b.tipoComprobante] ?? 99) || a.serie.localeCompare(b.serie));

    return {
      series,
      resumen: {
        totalSeries: series.length,
        seriesOk: series.filter(s => s.estado === 'OK').length,
        seriesConGaps: series.filter(s => s.estado === 'GAPS').length,
        seriesDesincronizadas: series.filter(s => s.estado === 'DESINCRONIZADO').length,
        totalFaltantes: series.reduce((acc, s) => acc + s.totalFaltantes, 0),
      },
    };
  }

  // ── Monitor: Listar comprobantes con filtros ──

  async listarComprobantes(empresaId: string, filtros: {
    tipo?: string;
    sunatStatus?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    busqueda?: string;
    page: number;
    limit: number;
  }) {
    const { tipo, sunatStatus, fechaDesde, fechaHasta, busqueda, page, limit } = filtros;
    const skip = (page - 1) * limit;

    const where: any = { empresaId };

    if (tipo) where.tipoComprobante = tipo;
    if (sunatStatus) where.sunatStatus = sunatStatus;

    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(`${fechaDesde}T00:00:00`);
      if (fechaHasta) where.fechaEmision.lte = new Date(`${fechaHasta}T23:59:59.999`);
    }

    if (busqueda) {
      where.OR = [
        { codigoGenerado: { contains: busqueda, mode: 'insensitive' } },
        { nombreCliente: { contains: busqueda, mode: 'insensitive' } },
        { numeroDocumento: { contains: busqueda } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.comprobanteElectronico.findMany({
        where,
        select: {
          id: true,
          tipoComprobante: true,
          serie: true,
          correlativo: true,
          codigoGenerado: true,
          nombreCliente: true,
          numeroDocumento: true,
          fechaEmision: true,
          moneda: true,
          total: true,
          estado: true,
          sunatStatus: true,
          sunatHash: true,
          enviadoAProveedor: true,
          errorProveedor: true,
          intentosEnvio: true,
          enlaceProveedor: true,
          sunatPdfUrl: true,
          anulado: true,
          motivoNota: true,
          tipoNotaCredito: true,
          tipoNotaDebito: true,
          comprobanteOrigenId: true,
          ventaId: true,
        },
        orderBy: { fechaEmision: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.comprobanteElectronico.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Enviar pendientes masivo ──

  async enviarPendientes(empresaId: string) {
    const pendientes = await this.prisma.comprobanteElectronico.findMany({
      where: {
        empresaId,
        sunatStatus: { in: ['PENDIENTE', 'ERROR_COMUNICACION'] },
        estado: 'REGISTRADO',
        intentosEnvio: { lt: MAX_INTENTOS_ENVIO },
      },
      select: { id: true, codigoGenerado: true },
      orderBy: { fechaEmision: 'desc' },
      take: ENVIO_BATCH_SIZE,
    });

    let enviados = 0;
    let errores = 0;

    for (const comp of pendientes) {
      try {
        await this.enviarComprobante(comp.id, empresaId);
        const updated = await this.prisma.comprobanteElectronico.findUnique({
          where: { id: comp.id },
          select: { sunatStatus: true },
        });
        if (updated?.sunatStatus === 'ACEPTADO') enviados++;
        else errores++;
      } catch {
        errores++;
      }
    }

    return { total: pendientes.length, enviados, errores };
  }

  // ── Core: Enviar comprobante al proveedor ──

  async enviarComprobante(comprobanteId: string, empresaId: string): Promise<void> {
    try {
      const comprobante = await this.prisma.comprobanteElectronico.findFirst({
        where: { id: comprobanteId, empresaId },
        include: {
          detalles: {
            include: {
              producto: { select: { codigoEmpresa: true } },
              servicio: { select: { codigoEmpresa: true } },
            },
          },
          comprobanteOrigen: {
            select: { tipoComprobante: true, serie: true, correlativo: true },
          },
          venta: {
            select: {
              sedeId: true,
              descuento: true,
              esCredito: true,
              cuotas: {
                select: { numero: true, monto: true, fechaVencimiento: true },
                orderBy: { numero: 'asc' },
              },
            },
          },
        },
      });

      if (!comprobante) {
        this.logger.warn(`Comprobante ${comprobanteId} no encontrado`);
        return;
      }

      // Resolver sedeId: del comprobante directo, o de la venta asociada
      const sedeId = comprobante.sedeId || comprobante.venta?.sedeId || null;

      const config = await this.getConfigFacturacionEfectiva(empresaId, sedeId);
      if (!config.facturacionActiva || !config.proveedorRuta || !config.proveedorToken) {
        this.logger.log(`Facturación no configurada/activa para empresa ${empresaId}, omitiendo envío`);
        return;
      }

      this.logger.log(`Enviando comprobante ${comprobante.codigoGenerado}`);

      const result: EnvioResult = await this.provider.enviar(
        comprobante as any,
        config as any,
        comprobante.comprobanteOrigen as any,
      );

      if (result.aceptado) {
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: {
            sunatHash: result.hash ?? null,
            sunatXmlUrl: result.xmlUrl ?? null,
            sunatPdfUrl: result.pdfUrl ?? null,
            sunatCdrUrl: result.cdrUrl ?? null,
            cadenaQR: result.cadenaQR ?? null,
            enlaceProveedor: result.enlace ?? null,
            cdrResponse: result.rawResponse ?? null,
            enviadoAProveedor: true,
            sunatStatus: 'ACEPTADO',
            estado: 'ACEPTADO',
            intentosEnvio: { increment: 1 },
            ultimoIntentoEnvio: new Date(),
          },
        });
        this.logger.log(`Comprobante ${comprobante.codigoGenerado} ACEPTADO`);
      } else if (result.procesando) {
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: {
            sunatHash: result.hash ?? null,
            sunatXmlUrl: result.xmlUrl ?? null,
            sunatPdfUrl: result.pdfUrl ?? null,
            sunatCdrUrl: result.cdrUrl ?? null,
            cadenaQR: result.cadenaQR ?? null,
            enlaceProveedor: result.enlace ?? null,
            enviadoAProveedor: true,
            sunatStatus: 'PROCESANDO',
            intentosEnvio: { increment: 1 },
            ultimoIntentoEnvio: new Date(),
          },
        });
        this.logger.log(`Comprobante ${comprobante.codigoGenerado} enviado, pendiente confirmación SUNAT`);
      } else if (result.yaExiste) {
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: {
            sunatStatus: 'ACEPTADO',
            estado: 'ACEPTADO',
            enviadoAProveedor: true,
            cdrResponse: result.rawResponse ?? null,
            intentosEnvio: { increment: 1 },
            ultimoIntentoEnvio: new Date(),
          },
        });
        this.logger.log(`Comprobante ${comprobante.codigoGenerado} ya existía, marcado como ACEPTADO`);
      } else {
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: {
            sunatStatus: 'RECHAZADO',
            estado: 'RECHAZADO',
            enviadoAProveedor: true,
            errorProveedor: result.error || 'Rechazado por SUNAT',
            cdrResponse: result.rawResponse ?? null,
            intentosEnvio: { increment: 1 },
            ultimoIntentoEnvio: new Date(),
          },
        });
        this.logger.warn(`Comprobante ${comprobante.codigoGenerado} RECHAZADO: ${result.error}`);
      }
    } catch (error: any) {
      this.logger.error(`Error enviando comprobante ${comprobanteId}: ${error.message}`);
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobanteId },
        data: {
          sunatStatus: 'ERROR_COMUNICACION',
          errorProveedor: error.message,
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
        },
      }).catch(() => {}); // Silenciar errores de update
    }
  }

  // ── Reenviar (alias público) ──

  async reenviarComprobante(comprobanteId: string, empresaId: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
      select: { id: true, sunatStatus: true, estado: true },
    });

    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    await this.enviarComprobante(comprobanteId, empresaId);

    return this.prisma.comprobanteElectronico.findUnique({
      where: { id: comprobanteId },
      select: {
        id: true, sunatStatus: true, estado: true, sunatHash: true,
        sunatXmlUrl: true, sunatPdfUrl: true, cadenaQR: true,
        errorProveedor: true, intentosEnvio: true,
      },
    });
  }

  // ── Consultar estado en SUNAT ──

  async consultarComprobante(comprobanteId: string, empresaId: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
      select: { id: true, tipoComprobante: true, serie: true, correlativo: true, sedeId: true },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    const config = await this.getConfigFacturacionEfectiva(empresaId, comprobante.sedeId);
    if (!config.facturacionActiva) throw new BadRequestException('Facturación no configurada');

    const result = await this.provider.consultar(comprobante as any, config as any);

    if (result.aceptado) {
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobanteId },
        data: {
          sunatHash: result.hash ?? undefined,
          sunatXmlUrl: result.xmlUrl ?? undefined,
          sunatPdfUrl: result.pdfUrl ?? undefined,
          sunatCdrUrl: result.cdrUrl ?? undefined,
          cadenaQR: result.cadenaQR ?? undefined,
          enlaceProveedor: result.enlace ?? undefined,
          sunatStatus: 'ACEPTADO',
          estado: 'ACEPTADO',
        },
      });
    }

    return result.rawResponse;
  }

  // ── Anular comprobante ──

  async anularComprobante(comprobanteId: string, empresaId: string, motivo: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');
    if (comprobante.anulado) throw new BadRequestException('El comprobante ya está anulado');

    const config = await this.getConfigFacturacionEfectiva(empresaId, comprobante.sedeId);
    const result = await this.provider.anular(comprobante as any, motivo, config as any);

    await this.prisma.comprobanteElectronico.update({
      where: { id: comprobanteId },
      data: {
        anulado: true,
        motivoAnulacion: motivo,
        estado: 'ANULADO',
        cdrResponse: result.rawResponse ?? null,
      },
    });

    return result.rawResponse;
  }

  // ── Consultar anulación ──

  async consultarAnulacion(comprobanteId: string, empresaId: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
      select: { id: true, tipoComprobante: true, serie: true, correlativo: true, sedeId: true },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    const config = await this.getConfigFacturacionEfectiva(empresaId, comprobante.sedeId);
    return this.provider.consultarAnulacion(comprobante as any, config as any);
  }

  // ── Crear Nota de Crédito ──

  async crearNotaCredito(
    comprobanteOrigenId: string,
    empresaId: string,
    dto: CrearNotaDto,
  ): Promise<any> {
    return this.crearNota(comprobanteOrigenId, empresaId, dto, 'NOTA_CREDITO');
  }

  // ── Crear Nota de Débito ──

  async crearNotaDebito(
    comprobanteOrigenId: string,
    empresaId: string,
    dto: CrearNotaDto,
  ): Promise<any> {
    return this.crearNota(comprobanteOrigenId, empresaId, dto, 'NOTA_DEBITO');
  }

  // ── Configuración ──

  async getConfiguracion(empresaId: string) {
    return this.prisma.configuracionFacturacion.findUnique({
      where: { empresaId },
    });
  }

  async updateConfiguracion(empresaId: string, dto: ConfiguracionFacturacionDto, userId?: string) {
    // Obtener config anterior para comparar cambios
    const anterior = await this.prisma.configuracionFacturacion.findUnique({
      where: { empresaId },
    });

    const resultado = await this.prisma.configuracionFacturacion.upsert({
      where: { empresaId },
      update: { ...dto },
      create: { empresaId, ...dto },
    });

    // Registrar auditoría con campos que cambiaron
    const cambios: Record<string, { antes: any; despues: any }> = {};
    if (anterior) {
      for (const key of Object.keys(dto) as Array<keyof typeof dto>) {
        const valorAnterior = (anterior as any)[key];
        const valorNuevo = dto[key];
        if (valorNuevo !== undefined && String(valorAnterior) !== String(valorNuevo)) {
          // No loguear tokens completos por seguridad
          const esSecreto = key === 'proveedorToken';
          cambios[key] = {
            antes: esSecreto ? '***' : valorAnterior,
            despues: esSecreto ? '***' : valorNuevo,
          };
        }
      }
    }

    if (Object.keys(cambios).length > 0 || !anterior) {
      this.auditService.log({
        usuarioId: userId,
        empresaId,
        accion: 'CONFIG_ACTUALIZADA',
        entidad: 'ConfiguracionFacturacion',
        entidadId: resultado.id,
        detalle: anterior
          ? `Actualización: ${Object.keys(cambios).join(', ')}`
          : 'Configuración de facturación creada',
        metadata: cambios,
      });
    }

    return resultado;
  }

  // ── Privados ──

  private async crearNota(
    comprobanteOrigenId: string,
    empresaId: string,
    dto: CrearNotaDto,
    tipoNota: 'NOTA_CREDITO' | 'NOTA_DEBITO',
  ) {
    const origen = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteOrigenId, empresaId },
      include: {
        detalles: true,
      },
    });

    if (!origen) throw new NotFoundException('Comprobante origen no encontrado');
    if (origen.sunatStatus !== 'ACEPTADO') {
      throw new BadRequestException('Solo se pueden generar notas de comprobantes ACEPTADOS por SUNAT');
    }
    if (origen.anulado) throw new BadRequestException('El comprobante origen está anulado');

    return this.prisma.$transaction(async (tx) => {
      // Lock sede para serie/correlativo (atómico: increment + read en un solo UPDATE)
      const esNotaCredito = tipoNota === 'NOTA_CREDITO';
      const campoUltimo = esNotaCredito ? 'ultimoNumeroNotaCredito' : 'ultimoNumeroNotaDebito';
      const campoSerie = esNotaCredito ? 'serieNotaCredito' : 'serieNotaDebito';

      // Lock con FOR UPDATE, luego increment atómico para evitar race conditions
      const [sedeLocked] = await tx.$queryRaw<any[]>`
        SELECT id, "${Prisma.raw(campoSerie)}" as serie, "${Prisma.raw(campoUltimo)}" as ultimo
        FROM "Sede" WHERE id = ${dto.sedeId} AND "empresaId" = ${empresaId} FOR UPDATE
      `;
      if (!sedeLocked) throw new BadRequestException('Sede no encontrada o no pertenece a esta empresa');

      // Increment atómico: evita race condition si 2 requests concurrentes pasan el lock
      const sedeActualizada = await tx.sede.update({
        where: { id: dto.sedeId },
        data: { [campoUltimo]: { increment: 1 } },
        select: { [campoUltimo]: true },
      });
      const nuevoCorrelativo: number = (sedeActualizada as any)[campoUltimo];

      // Serie desde la Sede (no hardcoded) — respeta configuración del usuario
      const serie: string = sedeLocked.serie || (
        (origen.tipoComprobante === 'FACTURA' ? 'F' : 'B') +
        (esNotaCredito ? 'C01' : 'D01')
      );

      const correlativo = String(nuevoCorrelativo).padStart(8, '0');
      const codigoGenerado = `${serie}-${correlativo}`;

      // Items: usar del DTO o copiar del original
      const itemsOrigen = dto.items && dto.items.length > 0
        ? dto.items.map((item) => ({
            descripcion: item.descripcion,
            cantidad: new Prisma.Decimal(item.cantidad),
            valorUnitario: new Prisma.Decimal(item.valorUnitario.toFixed(2)),
            precioUnitario: new Prisma.Decimal(item.precioUnitario.toFixed(2)),
            tipoAfectacion: item.tipoAfectacion || '10',
            igv: new Prisma.Decimal((item.igv || 0).toFixed(2)),
            icbper: new Prisma.Decimal((item.icbper || 0).toFixed(2)),
            valorVenta: new Prisma.Decimal((item.subtotal || item.valorUnitario * item.cantidad).toFixed(2)),
            subtotal: new Prisma.Decimal((item.subtotal || item.valorUnitario * item.cantidad).toFixed(2)),
            total: new Prisma.Decimal((item.total || item.precioUnitario * item.cantidad).toFixed(2)),
          }))
        : origen.detalles.map((d) => ({
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            valorUnitario: d.valorUnitario,
            precioUnitario: d.precioUnitario,
            tipoAfectacion: d.tipoAfectacion,
            igv: d.igv,
            icbper: d.icbper,
            valorVenta: d.valorVenta,
            subtotal: d.subtotal,
            total: d.total,
            ...(d.productoId ? { producto: { connect: { id: d.productoId } } } : {}),
          }));

      const nota = await tx.comprobanteElectronico.create({
        data: {
          empresaId,
          clienteId: origen.clienteId,
          clienteEmpresaId: origen.clienteEmpresaId,
          tipoComprobante: tipoNota as any,
          serie,
          correlativo,
          codigoGenerado,
          tipoDocumento: origen.tipoDocumento,
          numeroDocumento: origen.numeroDocumento,
          nombreCliente: origen.nombreCliente,
          direccionCliente: origen.direccionCliente,
          emailCliente: origen.emailCliente,
          moneda: origen.moneda,
          tipoCambio: origen.tipoCambio,
          gravada: origen.gravada,
          exonerada: origen.exonerada,
          inafecta: origen.inafecta,
          igv: origen.igv,
          totalIgv: origen.totalIgv,
          icbper: origen.icbper,
          total: origen.total,
          estado: 'REGISTRADO' as any,
          comprobanteOrigenId,
          tipoNotaCredito: tipoNota === 'NOTA_CREDITO' ? dto.tipoNota : null,
          tipoNotaDebito: tipoNota === 'NOTA_DEBITO' ? dto.tipoNota : null,
          motivoNota: dto.motivo,
          detalles: {
            create: itemsOrigen,
          },
        },
        include: { detalles: true },
      });

      return nota;
    }, { timeout: 15000 }).then(async (nota) => {
      // Fire-after-commit: enviar al proveedor
      this.enviarComprobante(nota.id, empresaId)
        .catch((err) => this.logger.warn(`Envío nota fallido: ${err?.message}`));
      return nota;
    });
  }

}
