
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { AuditService } from '../audit/audit.service';
import { EnvioResult, ProveedorSeriesInfo } from './facturacion-provider.interface';
import { FacturacionProviderFactory, PROVEEDORES_ARCHIVADOS } from './providers/facturacion-provider.factory';
import { CrearNotaDto } from './dto/crear-nota.dto';
import { ConfiguracionFacturacionDto } from './dto/configuracion-facturacion.dto';
import { ProbarConexionDto, ProbarConexionResponse } from './dto/probar-conexion.dto';
import {
  AplicarSincronizacionDto,
  SeleccionSerieDto,
} from './dto/sincronizar-series.dto';
import {
  AccionDiff,
  DiffSerie,
  SincronizacionPreviewResponse,
  ResultadoAplicarSincronizacion,
} from './dto/sincronizacion-preview.response';
import { Prisma, ProveedorFacturacion } from '@prisma/client';
import {
  esMotivoValido,
  getMotivos,
  MotivoNota,
  TipoNota,
} from './catalogos-sunat';

/**
 * Mapeo entre tipo de documento SUNAT y los campos de Sede donde se guarda
 * la serie y el contador. Clave para el diff y el apply.
 *
 * NC (07) y ND (08) tienen DOS slots cada una porque SUNAT exige series
 * distintas según el documento afectado:
 *   - NC sobre Factura → serie con prefijo "F" (FC*)
 *   - NC sobre Boleta  → serie con prefijo "B" (BC*)
 *   - ND sobre Factura → serie con prefijo "F" (FD*)
 *   - ND sobre Boleta  → serie con prefijo "B" (BD*)
 * El campo `prefijoSerie` filtra qué serie del proveedor matchea con qué slot.
 */
const TIPO_DOC_A_SEDE = [
  { tipoDoc: '01', nombre: 'Factura',           prefijoSerie: null, campoSerie: 'serieFactura',            campoContador: 'ultimoNumeroFactura' },
  { tipoDoc: '03', nombre: 'Boleta',            prefijoSerie: null, campoSerie: 'serieBoleta',             campoContador: 'ultimoNumeroBoleta' },
  { tipoDoc: '07', nombre: 'NC sobre Factura',  prefijoSerie: 'F',  campoSerie: 'serieNotaCredito',        campoContador: 'ultimoNumeroNotaCredito' },
  { tipoDoc: '07', nombre: 'NC sobre Boleta',   prefijoSerie: 'B',  campoSerie: 'serieNotaCreditoBoleta',  campoContador: 'ultimoNumeroNotaCreditoBoleta' },
  { tipoDoc: '08', nombre: 'ND sobre Factura',  prefijoSerie: 'F',  campoSerie: 'serieNotaDebito',         campoContador: 'ultimoNumeroNotaDebito' },
  { tipoDoc: '08', nombre: 'ND sobre Boleta',   prefijoSerie: 'B',  campoSerie: 'serieNotaDebitoBoleta',   campoContador: 'ultimoNumeroNotaDebitoBoleta' },
  { tipoDoc: '09', nombre: 'Guía de Remisión',  prefijoSerie: null, campoSerie: 'serieGuiaRemision',       campoContador: 'ultimoNumeroGuiaRemision' },
] as const;

type TipoComprobanteInterno = 'FACTURA' | 'BOLETA' | 'NOTA_CREDITO' | 'NOTA_DEBITO' | 'GUIA_REMISION';
const TIPO_DOC_A_COMPROBANTE: Record<string, TipoComprobanteInterno> = {
  '01': 'FACTURA',
  '03': 'BOLETA',
  '07': 'NOTA_CREDITO',
  '08': 'NOTA_DEBITO',
  '09': 'GUIA_REMISION',
};

/** Constantes de envío */
const ENVIO_BATCH_SIZE = 50;
const MAX_FALTANTES_REPORTE = 50;
const MAX_INTENTOS_ENVIO = 10;

@Injectable()
export class FacturacionService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providerFactory: FacturacionProviderFactory,
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
          proveedorActivo: true, proveedorRuta: true, proveedorToken: true, proveedorConfig: true,
          facturacionActiva: true,
          entorno: true, porcentajeIGV: true, resolucionSunat: true,
          emailFacturacion: true, textoPiePagina: true,
        },
      }),
      sedeId
        ? this.prisma.sede.findFirst({
            where: { id: sedeId, empresaId },
            select: {
              rucSede: true, razonSocialSede: true, direccionFiscalSede: true,
              direccion: true,
              proveedorActivo: true, proveedorRuta: true, proveedorToken: true, proveedorConfig: true,
              facturacionActiva: true,
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
      // Dirección: si la sede no tiene direccionFiscalSede registrada para SUNAT,
      // caemos a su dirección operativa (lo que el usuario llena más seguido en
      // "Dirección") antes de llegar al fallback empresa. Para anexos SUNAT con
      // RUC propio se debe llenar direccionFiscalSede explícitamente.
      ruc:              sede?.rucSede              ?? empresa?.ruc            ?? null,
      razonSocial:      sede?.razonSocialSede      ?? empresa?.razonSocial   ?? null,
      direccionFiscal:  sede?.direccionFiscalSede  ?? sede?.direccion        ?? empresa?.direccionFiscal ?? null,
      // Marca: ConfigDocumentos > Empresa.nombre
      nombreComercial:  configDoc?.nombreComercial  ?? empresa?.nombre        ?? null,
      // Logo: ConfigDocumentos > Empresa
      logo:             configDoc?.logoUrl          ?? empresa?.logo          ?? null,
      // Contacto: Sede > Empresa
      telefono:         sede?.telefono              ?? empresa?.telefono      ?? null,
      email:            sede?.email                 ?? empresa?.email         ?? null,
      emailFacturacion: config?.emailFacturacion    ?? sede?.email            ?? empresa?.email ?? null,
      // Proveedor: Sede > ConfigFacturacion
      proveedorActivo:   sede?.proveedorActivo        ?? config?.proveedorActivo ?? ProveedorFacturacion.SYNCROFACT,
      proveedorRuta:     sede?.proveedorRuta          ?? config?.proveedorRuta   ?? null,
      proveedorToken:    sede?.proveedorToken         ?? config?.proveedorToken  ?? null,
      // proveedorConfig: merge granular. Sede hace override por campo sobre empresa.
      // Ej. si empresa={companyId:3, branchId:3} y sede={branchId:5}, efectivo={companyId:3, branchId:5}.
      proveedorConfig: (() => {
        const empresaCfg = (config?.proveedorConfig as Record<string, any> | null) ?? null;
        const sedeCfg = (sede?.proveedorConfig as Record<string, any> | null) ?? null;
        if (!empresaCfg && !sedeCfg) return null;
        return { ...(empresaCfg ?? {}), ...(sedeCfg ?? {}) };
      })(),
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
          sunatCodigo: true,
          intentosEnvio: true,
          enlaceProveedor: true,
          sunatPdfUrl: true,
          anulado: true,
          motivoNota: true,
          tipoNotaCredito: true,
          tipoNotaDebito: true,
          comprobanteOrigenId: true,
          ventaId: true,
          sedeId: true,
          proveedorEmisor: true,
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
    const archivados = Array.from(PROVEEDORES_ARCHIVADOS);

    const pendientes = await this.prisma.comprobanteElectronico.findMany({
      where: {
        empresaId,
        sunatStatus: { in: ['PENDIENTE', 'ERROR_COMUNICACION'] },
        estado: 'REGISTRADO',
        intentosEnvio: { lt: MAX_INTENTOS_ENVIO },
        // No intentar reenviar comprobantes de proveedores archivados
        ...(archivados.length > 0 ? { proveedorEmisor: { notIn: archivados } } : {}),
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
              metodoPago: true,
              cuotas: {
                select: { numero: true, monto: true, fechaVencimiento: true },
                orderBy: { numero: 'asc' },
              },
              pagos: {
                select: { metodoPago: true, monto: true, referencia: true, banco: true },
                orderBy: { fechaPago: 'asc' },
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

      // Resolver proveedor: si el comprobante ya tiene uno (reenvío) lo respeta,
      // si es primera emisión, toma el activo de la config y lo graba.
      let proveedorEmisor = comprobante.proveedorEmisor;
      if (!proveedorEmisor) {
        proveedorEmisor = config.proveedorActivo;
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: { proveedorEmisor },
        });
      }

      // Proveedor archivado: solo lectura, no se puede reenviar
      if (this.providerFactory.isArchivado(proveedorEmisor)) {
        const msg = this.providerFactory.mensajeArchivado(proveedorEmisor);
        this.logger.warn(`Comprobante ${comprobante.codigoGenerado}: ${msg}`);
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: { errorProveedor: msg },
        });
        return;
      }

      this.logger.log(`Enviando comprobante ${comprobante.codigoGenerado} vía ${proveedorEmisor}`);

      const provider = this.providerFactory.get(proveedorEmisor);
      const result: EnvioResult = await provider.enviar(
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
            // Limpiar error/código de un rechazo previo (reenvío exitoso)
            errorProveedor: null,
            sunatCodigo: null,
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
            // Persistir rawResponse también en rama PROCESANDO para que el
            // _syncrofactId quede disponible (necesario para anulación, RC, etc.)
            cdrResponse: result.rawResponse ?? null,
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
            sunatCodigo: result.errorCode ?? null,
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
        errorProveedor: true, sunatCodigo: true, intentosEnvio: true,
      },
    });
  }

  // ── Consultar estado en SUNAT ──

  async consultarComprobante(comprobanteId: string, empresaId: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
      select: {
        id: true, tipoComprobante: true, serie: true, correlativo: true,
        sedeId: true, proveedorEmisor: true, cdrResponse: true,
      },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    if (this.providerFactory.isArchivado(comprobante.proveedorEmisor)) {
      throw new BadRequestException(
        this.providerFactory.mensajeArchivado(comprobante.proveedorEmisor!),
      );
    }

    const config = await this.getConfigFacturacionEfectiva(empresaId, comprobante.sedeId);
    if (!config.facturacionActiva) throw new BadRequestException('Facturación no configurada');

    const provider = this.providerFactory.get(comprobante.proveedorEmisor);
    const result = await provider.consultar(comprobante as any, config as any);

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
          errorProveedor: null,
          sunatCodigo: null,
        },
      });
    } else if (!result.procesando && result.error) {
      // Rechazo confirmado al consultar: persistir el mensaje + código SUNAT
      // para que el monitor muestre el error exacto.
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobanteId },
        data: {
          sunatStatus: 'RECHAZADO',
          estado: 'RECHAZADO',
          errorProveedor: result.error,
          sunatCodigo: result.errorCode ?? null,
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

    if (this.providerFactory.isArchivado(comprobante.proveedorEmisor)) {
      throw new BadRequestException(
        this.providerFactory.mensajeArchivado(comprobante.proveedorEmisor!),
      );
    }

    const config = await this.getConfigFacturacionEfectiva(empresaId, comprobante.sedeId);
    const provider = this.providerFactory.get(comprobante.proveedorEmisor);
    const result = await provider.anular(comprobante as any, motivo, config as any);

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
      select: {
        id: true, tipoComprobante: true, serie: true, correlativo: true,
        sedeId: true, proveedorEmisor: true,
      },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    if (this.providerFactory.isArchivado(comprobante.proveedorEmisor)) {
      throw new BadRequestException(
        this.providerFactory.mensajeArchivado(comprobante.proveedorEmisor!),
      );
    }

    const config = await this.getConfigFacturacionEfectiva(empresaId, comprobante.sedeId);
    const provider = this.providerFactory.get(comprobante.proveedorEmisor);
    return provider.consultarAnulacion(comprobante as any, config as any);
  }

  // ── Catálogos SUNAT ──

  /**
   * Devuelve los motivos válidos del catálogo SUNAT correspondiente al tipo de nota.
   * Catálogo 09 para NC (12 motivos), catálogo 10 para ND (5 motivos).
   */
  getMotivosNota(tipo: string): ReadonlyArray<MotivoNota> {
    if (tipo !== 'NOTA_CREDITO' && tipo !== 'NOTA_DEBITO') {
      throw new BadRequestException(
        `Tipo inválido: ${tipo}. Valores aceptados: NOTA_CREDITO, NOTA_DEBITO`,
      );
    }
    return getMotivos(tipo as TipoNota);
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

  // ── Consulta masiva de pendientes (Syncrofact batch-status) ──

  /**
   * Mapeo tipo_comprobante interno → código SUNAT catálogo 01.
   */
  private tipoDocSunatDesdeInterno(tipo: string): string | null {
    switch (tipo) {
      case 'FACTURA': return '01';
      case 'BOLETA': return '03';
      case 'NOTA_CREDITO': return '07';
      case 'NOTA_DEBITO': return '08';
      case 'GUIA_REMISION': return '09';
      default: return null;
    }
  }

  /**
   * Consulta masiva del estado SUNAT para los comprobantes PROCESANDO de la
   * empresa, usando batchStatus del provider.
   *
   * Optimizaciones:
   *  - (C) LIMIT: procesa hasta MAX_POR_CALL por invocación. Si hay más, el
   *    endpoint devuelve `truncado:true` y el usuario/cron reinvoca.
   *  - (B) Paralelismo: los chunks HTTP del proveedor corren con Promise.all.
   *  - (A) Bulk UPDATE: al terminar se ejecutan solo 2 updateMany (ACEPTADOS y
   *    RECHAZADOS) en vez de N updates individuales.
   *
   * Devuelve resumen con contadores por categoría.
   */
  async consultarPendientesBatch(empresaId: string): Promise<{
    total: number;
    procesados: number;
    pendientesRestantes: number;
    truncado: boolean;
    actualizados: number;
    aunProcesando: number;
    noEncontrados: number;
    errores: Array<{ comprobanteId: string; error: string }>;
  }> {
    /** (C) Tope duro por invocación — evita timeouts y garantiza latencia predecible */
    const MAX_POR_CALL = 500;
    /** Tamaño del chunk al proveedor (límite de Syncrofact batch-status) */
    const CHUNK_SIZE = 50;

    // Count total para reportar `truncado` sin traerlos todos a memoria.
    const total = await this.prisma.comprobanteElectronico.count({
      where: { empresaId, sunatStatus: 'PROCESANDO' },
    });

    const pendientes = await this.prisma.comprobanteElectronico.findMany({
      where: { empresaId, sunatStatus: 'PROCESANDO' },
      select: {
        id: true, tipoComprobante: true, serie: true, correlativo: true,
        sedeId: true, proveedorEmisor: true,
      },
      take: MAX_POR_CALL,
      orderBy: { actualizadoEn: 'asc' }, // procesa los más antiguos primero
    });

    const resumen = {
      total,
      procesados: pendientes.length,
      pendientesRestantes: Math.max(0, total - pendientes.length),
      truncado: total > pendientes.length,
      actualizados: 0,
      aunProcesando: 0,
      noEncontrados: 0,
      errores: [] as Array<{ comprobanteId: string; error: string }>,
    };

    if (!pendientes.length) return resumen;

    // Acumuladores para (A) bulk update al final
    const idsAceptados: string[] = [];
    const idsRechazados: string[] = [];

    // Agrupar por (sedeId, tipoComprobante, proveedorEmisor). Cada combinación
    // usa un provider/config distinto y tipo_documento SUNAT distinto.
    const grupos = new Map<string, typeof pendientes>();
    for (const c of pendientes) {
      const key = `${c.sedeId ?? '_'}|${c.tipoComprobante}|${c.proveedorEmisor ?? '_'}`;
      const arr = grupos.get(key) ?? [];
      arr.push(c);
      grupos.set(key, arr);
    }

    for (const [key, comprobantes] of grupos) {
      const [sedeId, tipoComprobante, proveedor] = key.split('|');

      if (this.providerFactory.isArchivado(proveedor as any)) {
        for (const c of comprobantes) {
          resumen.errores.push({
            comprobanteId: c.id,
            error: `Proveedor ${proveedor} deprecado — reenvío manual requerido`,
          });
        }
        continue;
      }

      const provider = this.providerFactory.get(proveedor as any);
      if (typeof provider.batchStatus !== 'function') {
        for (const c of comprobantes) {
          resumen.errores.push({
            comprobanteId: c.id,
            error: `${proveedor} no soporta consulta batch — use Consultar individual`,
          });
        }
        continue;
      }

      const tipoSunat = this.tipoDocSunatDesdeInterno(tipoComprobante);
      if (!tipoSunat) {
        for (const c of comprobantes) {
          resumen.errores.push({ comprobanteId: c.id, error: `Tipo ${tipoComprobante} no soportado` });
        }
        continue;
      }

      const config = await this.getConfigFacturacionEfectiva(empresaId, sedeId === '_' ? null : sedeId);
      if (!config.facturacionActiva) {
        for (const c of comprobantes) {
          resumen.errores.push({ comprobanteId: c.id, error: 'Facturación desactivada para esta sede' });
        }
        continue;
      }

      // Chunking: max CHUNK_SIZE refs por request
      const chunks: typeof comprobantes[] = [];
      for (let i = 0; i < comprobantes.length; i += CHUNK_SIZE) {
        chunks.push(comprobantes.slice(i, i + CHUNK_SIZE));
      }

      // (B) Paralelizar requests HTTP del grupo. Usa allSettled implícito:
      // capturamos el error dentro del .catch para que un chunk fallido
      // no tumbe a los demás del mismo grupo.
      type ChunkOk = { ok: true; chunk: typeof comprobantes; resultados: import('./facturacion-provider.interface').BatchStatusResult[] };
      type ChunkErr = { ok: false; chunk: typeof comprobantes; error: string };
      const promesas: Promise<ChunkOk | ChunkErr>[] = chunks.map((chunk) =>
        provider.batchStatus!({ tipoDocumento: tipoSunat, referencias: chunk.map((c) => c.id) }, config as any)
          .then<ChunkOk>((resultados) => ({ ok: true, chunk, resultados }))
          .catch<ChunkErr>((e: any) => ({ ok: false, chunk, error: e?.message || 'Error batch-status' })),
      );
      const chunkResults = await Promise.all(promesas);

      for (const cr of chunkResults) {
        if (cr.ok === false) {
          for (const c of cr.chunk) {
            resumen.errores.push({ comprobanteId: c.id, error: cr.error });
          }
          continue;
        }
        const porRef = new Map(cr.chunk.map((c) => [c.id, c]));
        for (const r of cr.resultados) {
          const comp = porRef.get(r.referenciaInterna);
          if (!comp) continue;

          if (!r.encontrado) {
            resumen.noEncontrados++;
            continue;
          }

          const estado = (r.estadoSunat || '').toUpperCase();
          if (estado === 'ACEPTADO') {
            idsAceptados.push(comp.id);
            resumen.actualizados++;
          } else if (estado === 'RECHAZADO') {
            idsRechazados.push(comp.id);
            resumen.actualizados++;
          } else {
            resumen.aunProcesando++;
          }
        }
      }
    }

    // (A) Bulk UPDATE — 2 queries en vez de N individuales
    if (idsAceptados.length) {
      await this.prisma.comprobanteElectronico.updateMany({
        where: { id: { in: idsAceptados } },
        data: { sunatStatus: 'ACEPTADO', estado: 'ACEPTADO' },
      });
    }
    if (idsRechazados.length) {
      await this.prisma.comprobanteElectronico.updateMany({
        where: { id: { in: idsRechazados } },
        data: { sunatStatus: 'RECHAZADO', estado: 'RECHAZADO' },
      });
    }

    return resumen;
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

  async probarConexion(dto: ProbarConexionDto): Promise<ProbarConexionResponse> {
    const provider = this.providerFactory.get(dto.proveedorActivo);

    if (!provider.obtenerSeries) {
      return {
        ok: false,
        proveedor: dto.proveedorActivo,
        mensaje: `El proveedor ${dto.proveedorActivo} no expone un método de verificación. Los datos se guardarán tal cual.`,
      };
    }

    try {
      const info = await provider.obtenerSeries({
        proveedorRuta: dto.proveedorRuta,
        proveedorToken: dto.proveedorToken,
        proveedorConfig: dto.proveedorConfig ?? null,
      });

      const branches = (info.branches ?? []).map((b) => ({
        branchIdProveedor: Number(b.branchIdProveedor),
        codigo: b.codigo,
        nombre: b.nombre,
        totalSeries: (b.series ?? []).length,
      }));

      return {
        ok: true,
        proveedor: dto.proveedorActivo,
        mensaje: `Conexión exitosa. ${branches.length} sucursal(es) encontrada(s).`,
        branches,
      };
    } catch (err: any) {
      return {
        ok: false,
        proveedor: dto.proveedorActivo,
        mensaje: 'No se pudo conectar al proveedor',
        error: err?.message || String(err),
      };
    }
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
    if (origen.tipoComprobante !== 'FACTURA' && origen.tipoComprobante !== 'BOLETA') {
      throw new BadRequestException(
        `Solo se pueden generar notas sobre FACTURA o BOLETA. Tipo recibido: ${origen.tipoComprobante}`,
      );
    }
    if (origen.sunatStatus !== 'ACEPTADO') {
      throw new BadRequestException('Solo se pueden generar notas de comprobantes ACEPTADOS por SUNAT');
    }
    if (origen.anulado) throw new BadRequestException('El comprobante origen está anulado');

    if (!esMotivoValido(tipoNota, dto.tipoNota)) {
      const validos = getMotivos(tipoNota)
        .map((m) => `${m.codigo}=${m.descripcion}`)
        .join(', ');
      throw new BadRequestException(
        `Motivo ${dto.tipoNota} no es válido para ${tipoNota}. Códigos válidos: ${validos}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock sede para serie/correlativo (atómico: increment + read en un solo UPDATE).
      // SUNAT exige series distintas según el documento afectado (regla validada en CDR):
      //   NC sobre FACTURA → serie FC* (campo serieNotaCredito)
      //   NC sobre BOLETA  → serie BC* (campo serieNotaCreditoBoleta)
      //   ND sobre FACTURA → serie FD* (campo serieNotaDebito)
      //   ND sobre BOLETA  → serie BD* (campo serieNotaDebitoBoleta)
      const esNotaCredito = tipoNota === 'NOTA_CREDITO';
      const esBoletaOrigen = origen.tipoComprobante === 'BOLETA';
      const campoUltimo = esNotaCredito
        ? (esBoletaOrigen ? 'ultimoNumeroNotaCreditoBoleta' : 'ultimoNumeroNotaCredito')
        : (esBoletaOrigen ? 'ultimoNumeroNotaDebitoBoleta' : 'ultimoNumeroNotaDebito');
      const campoSerie = esNotaCredito
        ? (esBoletaOrigen ? 'serieNotaCreditoBoleta' : 'serieNotaCredito')
        : (esBoletaOrigen ? 'serieNotaDebitoBoleta' : 'serieNotaDebito');

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

      // Items: si vienen del DTO usamos esos (ND con cargo adicional, NC parcial,
      // etc.) y recalculamos totales del header desde ellos. Si no vienen, copiamos
      // del comprobante origen (caso "anular completo").
      const usaItemsCustom = !!(dto.items && dto.items.length > 0);
      const itemsParaCrear = usaItemsCustom
        ? dto.items!.map((item) => ({
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

      // Recalcular totales del header cuando hay items custom.
      // SUNAT cat. 07: 10=Gravado, 20=Exonerado, 30=Inafecto, 40=Exportación.
      let gravadaT = 0, exoneradaT = 0, inafectaT = 0, igvT = 0, icbperT = 0;
      if (usaItemsCustom) {
        for (const it of dto.items!) {
          const cant = Number(it.cantidad);
          const valorU = Number(it.valorUnitario);
          const sub = it.subtotal != null
            ? Number(it.subtotal)
            : Math.round(valorU * cant * 100) / 100;
          const igvIt = it.igv != null ? Number(it.igv) : 0;
          const icbperIt = it.icbper != null ? Number(it.icbper) : 0;
          const ta = it.tipoAfectacion || '10';
          if (ta === '20') exoneradaT += sub;
          else if (ta === '30') inafectaT += sub;
          else gravadaT += sub;
          igvT += igvIt;
          icbperT += icbperIt;
        }
      }
      const totalT = gravadaT + exoneradaT + inafectaT + igvT + icbperT;

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
          gravada: usaItemsCustom ? new Prisma.Decimal(gravadaT.toFixed(2)) : origen.gravada,
          exonerada: usaItemsCustom ? new Prisma.Decimal(exoneradaT.toFixed(2)) : origen.exonerada,
          inafecta: usaItemsCustom ? new Prisma.Decimal(inafectaT.toFixed(2)) : origen.inafecta,
          igv: usaItemsCustom ? new Prisma.Decimal(igvT.toFixed(2)) : origen.igv,
          totalIgv: usaItemsCustom ? new Prisma.Decimal(igvT.toFixed(2)) : origen.totalIgv,
          icbper: usaItemsCustom ? new Prisma.Decimal(icbperT.toFixed(2)) : origen.icbper,
          total: usaItemsCustom ? new Prisma.Decimal(totalT.toFixed(2)) : origen.total,
          estado: 'REGISTRADO' as any,
          comprobanteOrigenId,
          tipoNotaCredito: tipoNota === 'NOTA_CREDITO' ? dto.tipoNota : null,
          tipoNotaDebito: tipoNota === 'NOTA_DEBITO' ? dto.tipoNota : null,
          motivoNota: dto.motivo,
          detalles: {
            create: itemsParaCrear,
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

  // ── Sincronización de series con el proveedor ──

  /**
   * Consulta las series disponibles en el proveedor (ej. Syncrofact) y las
   * compara contra las configuradas en la Sede. Retorna un diff listo para
   * que el usuario decida qué aplicar. NO modifica la BD.
   */
  async previewSincronizacionSeries(
    empresaId: string,
    sedeId: string,
  ): Promise<SincronizacionPreviewResponse> {
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId },
      select: {
        id: true, nombre: true, empresaId: true,
        serieFactura: true, serieBoleta: true,
        serieNotaCredito: true, serieNotaCreditoBoleta: true,
        serieNotaDebito: true, serieNotaDebitoBoleta: true,
        serieGuiaRemision: true,
        ultimoNumeroFactura: true, ultimoNumeroBoleta: true,
        ultimoNumeroNotaCredito: true, ultimoNumeroNotaCreditoBoleta: true,
        ultimoNumeroNotaDebito: true, ultimoNumeroNotaDebitoBoleta: true,
        ultimoNumeroGuiaRemision: true,
        proveedorActivo: true, proveedorConfig: true,
        seriesSincronizadasEn: true,
      },
    });
    if (!sede) throw new NotFoundException('Sede no encontrada');

    const config = await this.getConfigFacturacionEfectiva(empresaId, sedeId);
    if (!config.facturacionActiva) {
      throw new BadRequestException('La facturación no está activa para esta sede');
    }
    if (this.providerFactory.isArchivado(config.proveedorActivo)) {
      throw new BadRequestException(
        this.providerFactory.mensajeArchivado(config.proveedorActivo),
      );
    }

    const provider = this.providerFactory.get(config.proveedorActivo);
    if (typeof provider.obtenerSeries !== 'function') {
      throw new BadRequestException(
        `El proveedor ${config.proveedorActivo} no soporta consulta de series. ` +
        `Configura manualmente la serie y el correlativo desde la pantalla de sede.`,
      );
    }

    let info: ProveedorSeriesInfo;
    try {
      info = await provider.obtenerSeries(config as any);
    } catch (err: any) {
      this.logger.warn(`Error consultando series del proveedor: ${err?.message}`);
      throw new BadRequestException(
        `No se pudieron consultar las series: ${err?.message || 'error desconocido'}`,
      );
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ruc: true },
    });

    // branchId actual de la sede en el proveedor (si está configurado)
    const branchIdActual = (sede.proveedorConfig as any)?.branchId ?? null;

    // Pre-contar comprobantes por serie local (para warnings de REEMPLAZAR_SERIE)
    const seriesLocales = TIPO_DOC_A_SEDE
      .map((t) => ({ tipoDoc: t.tipoDoc, serie: (sede as any)[t.campoSerie] as string | null }))
      .filter((s) => s.serie);

    const counts = new Map<string, number>();
    for (const { tipoDoc, serie } of seriesLocales) {
      const tipoComp = TIPO_DOC_A_COMPROBANTE[tipoDoc];
      if (!serie || !tipoComp) continue;
      const count = await this.prisma.comprobanteElectronico.count({
        where: { empresaId, sedeId, tipoComprobante: tipoComp as any, serie },
      });
      counts.set(`${tipoDoc}:${serie}`, count);
    }

    // MAX(correlativo) por (tipoComprobante, serie) en TODA la empresa.
    // La unique constraint en ComprobanteElectronico es (empresaId, tipoComprobante,
    // serie, correlativo) — sin sedeId — así que para detectar conflictos hay que
    // mirar todas las sedes de la empresa, no solo la sede que se está sincronizando.
    const maxPorSerie = new Map<string, number>();
    const maxRows = await this.prisma.$queryRaw<
      Array<{ tipoComprobante: string; serie: string; max: number | null }>
    >`SELECT "tipoComprobante"::text, serie, MAX(CAST(correlativo AS INTEGER)) as max
       FROM "ComprobanteElectronico"
       WHERE "empresaId" = ${empresaId}
       GROUP BY "tipoComprobante", serie`;
    for (const row of maxRows) {
      if (row.serie && row.max != null) {
        maxPorSerie.set(`${row.tipoComprobante}:${row.serie}`, Number(row.max));
      }
    }

    const branches = info.branches.map((b) => {
      const diffs: DiffSerie[] = TIPO_DOC_A_SEDE.map((t) => {
        const serieLocal = (sede as any)[t.campoSerie] as string | null;
        const correlativoLocal = (sede as any)[t.campoContador] as number;
        // Para tipoDoc 07 (NC) y 08 (ND) hay dos series distintas según el documento
        // afectado. Filtramos por prefijo de serie para diferenciar FC* vs BC* y
        // FD* vs BD*. Si no hay prefijo, simplemente match por tipo de documento.
        const serieProv = b.series.find((s) =>
          s.tipoDocumento === t.tipoDoc &&
          (t.prefijoSerie === null || s.serie.startsWith(t.prefijoSerie)),
        );
        const comprobantesLocal = serieLocal
          ? counts.get(`${t.tipoDoc}:${serieLocal}`) ?? 0
          : 0;
        // MAX correlativo en BD para la serie destino (la del proveedor),
        // que es lo que termina escrito si se aplica el sync.
        const tipoComp = TIPO_DOC_A_COMPROBANTE[t.tipoDoc];
        const maxBdEnSerieDestino = serieProv?.serie && tipoComp
          ? maxPorSerie.get(`${tipoComp}:${serieProv.serie}`) ?? 0
          : 0;

        return this.clasificarDiff({
          tipoDocumento: t.tipoDoc,
          tipoDocumentoNombre: t.nombre,
          serieLocal,
          correlativoLocal: serieLocal ? correlativoLocal : null,
          serieProveedor: serieProv?.serie ?? null,
          correlativoProveedor: serieProv?.correlativoActual ?? null,
          proximoNumeroProveedor: serieProv?.proximoNumero ?? null,
          comprobantesEmitidosLocalmente: comprobantesLocal,
          maxCorrelativoBdEnSerieDestino: maxBdEnSerieDestino,
        });
      });

      return {
        branchIdProveedor: b.branchIdProveedor,
        codigo: b.codigo,
        nombre: b.nombre,
        esActualDeLaSede:
          branchIdActual !== null &&
          String(branchIdActual) === String(b.branchIdProveedor),
        diffs,
      };
    });

    return {
      empresaId,
      sedeId: sede.id,
      sedeNombre: sede.nombre,
      rucEmpresa: empresa?.ruc ?? null,
      proveedorActivo: config.proveedorActivo,
      seriesSincronizadasEn: sede.seriesSincronizadasEn,
      branches,
      metadata: info.metadata,
    };
  }

  /**
   * Aplica las selecciones del usuario al Sede. Rechaza CONFLICTO siempre.
   * Actualiza proveedorConfig.branchId si se proporciona. Registra audit log.
   */
  async aplicarSincronizacionSeries(
    empresaId: string,
    dto: AplicarSincronizacionDto,
    userId?: string,
  ): Promise<ResultadoAplicarSincronizacion> {
    if (!dto.selecciones?.length) {
      throw new BadRequestException('No hay selecciones para aplicar');
    }

    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId },
      select: {
        id: true, empresaId: true, proveedorConfig: true,
        serieFactura: true, serieBoleta: true,
        serieNotaCredito: true, serieNotaCreditoBoleta: true,
        serieNotaDebito: true, serieNotaDebitoBoleta: true,
        serieGuiaRemision: true,
        ultimoNumeroFactura: true, ultimoNumeroBoleta: true,
        ultimoNumeroNotaCredito: true, ultimoNumeroNotaCreditoBoleta: true,
        ultimoNumeroNotaDebito: true, ultimoNumeroNotaDebitoBoleta: true,
        ultimoNumeroGuiaRemision: true,
      },
    });
    if (!sede) throw new NotFoundException('Sede no encontrada');

    const config = await this.getConfigFacturacionEfectiva(empresaId, dto.sedeId);
    if (!config.facturacionActiva) {
      throw new BadRequestException('La facturación no está activa para esta sede');
    }
    if (this.providerFactory.isArchivado(config.proveedorActivo)) {
      throw new BadRequestException(this.providerFactory.mensajeArchivado(config.proveedorActivo));
    }

    const aplicaciones = dto.selecciones.filter((s) => s.accion === 'APLICAR');
    const omitidos = dto.selecciones.length - aplicaciones.length;

    // Para validar CONFLICTO, releer correlativos locales bajo lock al aplicar.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Sede" WHERE id = ${dto.sedeId} AND "empresaId" = ${empresaId} FOR UPDATE`;

      const sedeLock = await tx.sede.findUnique({
        where: { id: dto.sedeId },
        select: {
          serieFactura: true, serieBoleta: true,
          serieNotaCredito: true, serieNotaCreditoBoleta: true,
          serieNotaDebito: true, serieNotaDebitoBoleta: true,
          serieGuiaRemision: true,
          ultimoNumeroFactura: true, ultimoNumeroBoleta: true,
          ultimoNumeroNotaCredito: true, ultimoNumeroNotaCreditoBoleta: true,
          ultimoNumeroNotaDebito: true, ultimoNumeroNotaDebitoBoleta: true,
          ultimoNumeroGuiaRemision: true,
          proveedorConfig: true,
        },
      });
      if (!sedeLock) throw new NotFoundException('Sede no encontrada');

      const errores: string[] = [];
      const cambios: ResultadoAplicarSincronizacion['cambios'] = [];
      const updateData: Record<string, any> = {};

      for (const sel of aplicaciones) {
        // Para tipoDoc 07/08 hay 2 slots distintos según prefijo (F* vs B*).
        // Inferimos el slot correcto a partir del prefijo de la serie del proveedor.
        const serieProvFiltro = sel.serieProveedor ?? '';
        const meta = TIPO_DOC_A_SEDE.find((t) =>
          t.tipoDoc === sel.tipoDocumento &&
          (t.prefijoSerie === null || serieProvFiltro.startsWith(t.prefijoSerie)),
        );
        if (!meta) {
          errores.push(`Tipo documento desconocido o prefijo no reconocido: ${sel.tipoDocumento} (${sel.serieProveedor ?? 'sin serie'})`);
          continue;
        }

        const serieActual = (sedeLock as any)[meta.campoSerie] as string | null;
        const correlativoActual = (sedeLock as any)[meta.campoContador] as number;

        // Rechazar CONFLICTO 1: correlativo local de la sede > proveedor.
        if (
          serieActual === sel.serieProveedor &&
          correlativoActual > sel.correlativoProveedor
        ) {
          errores.push(
            `${meta.nombre} (${serieActual}): correlativo local ${correlativoActual} > proveedor ${sel.correlativoProveedor}. Resuelva manualmente.`,
          );
          continue;
        }

        // Rechazar CONFLICTO 2: hay comprobantes en BD (de cualquier sede de la
        // empresa) con la serie destino y correlativo > proveedor. Aplicar bajaría
        // el contador y la próxima emisión chocaría con la unique constraint
        // (empresaId, tipoComprobante, serie, correlativo).
        const tipoComp = TIPO_DOC_A_COMPROBANTE[sel.tipoDocumento];
        let maxBdEnSerieDestino = 0;
        if (tipoComp && sel.serieProveedor) {
          const [maxRow] = await tx.$queryRaw<Array<{ max: number | null }>>`
            SELECT MAX(CAST(correlativo AS INTEGER)) as max
            FROM "ComprobanteElectronico"
            WHERE "empresaId" = ${empresaId}
              AND "tipoComprobante" = ${tipoComp}::"TipoComprobante"
              AND serie = ${sel.serieProveedor}`;
          maxBdEnSerieDestino = Number(maxRow?.max ?? 0);
        }

        if (maxBdEnSerieDestino > sel.correlativoProveedor) {
          errores.push(
            `${meta.nombre} (${sel.serieProveedor}): la empresa ya tiene comprobantes hasta correlativo ${maxBdEnSerieDestino} ` +
            `pero el proveedor está en ${sel.correlativoProveedor}. Aplicar produciría choque al emitir. Resuelva manualmente.`,
          );
          continue;
        }

        const accion: AccionDiff =
          serieActual === null ? 'CREAR_NUEVA'
            : serieActual !== sel.serieProveedor ? 'REEMPLAZAR_SERIE'
            : correlativoActual === sel.correlativoProveedor ? 'EN_SINCRONIA'
            : 'ACTUALIZAR_CORRELATIVO';

        if (accion === 'EN_SINCRONIA') {
          // Nada que cambiar, pero lo registramos como aplicado informativo
          continue;
        }

        updateData[meta.campoSerie] = sel.serieProveedor;
        // Defensa: el contador efectivo nunca debe quedar por debajo del MAX en BD.
        // Si BD tiene comprobantes hasta N y el proveedor reporta M < N, ya rechazamos
        // arriba. Si M >= N, escribimos M (correlativo del proveedor).
        updateData[meta.campoContador] = Math.max(sel.correlativoProveedor, maxBdEnSerieDestino);

        cambios.push({
          tipoDocumento: sel.tipoDocumento,
          campoSerie: meta.campoSerie,
          campoContador: meta.campoContador,
          serieAntes: serieActual,
          serieDespues: sel.serieProveedor,
          correlativoAntes: serieActual ? correlativoActual : null,
          correlativoDespues: sel.correlativoProveedor,
          accion,
        });
      }

      if (errores.length > 0 && cambios.length === 0) {
        throw new BadRequestException(`No se pudo sincronizar:\n${errores.join('\n')}`);
      }

      // Actualizar proveedorConfig.branchId si se proporciona
      let branchIdAplicado: string | number | null = null;
      if (dto.branchIdProveedor !== undefined && dto.branchIdProveedor !== null) {
        const cfgActual = (sedeLock.proveedorConfig as any) ?? {};
        updateData.proveedorConfig = { ...cfgActual, branchId: dto.branchIdProveedor };
        branchIdAplicado = dto.branchIdProveedor;
      }

      updateData.seriesSincronizadasEn = new Date();

      if (Object.keys(updateData).length > 0) {
        await tx.sede.update({ where: { id: dto.sedeId }, data: updateData });
      }

      // Audit log (fuera del lock, pero dentro del tx)
      this.auditService.log({
        usuarioId: userId,
        empresaId,
        accion: 'SERIES_SINCRONIZADAS',
        entidad: 'Sede',
        entidadId: dto.sedeId,
        detalle: `Sincronizadas ${cambios.length} series con proveedor ${config.proveedorActivo}`,
        metadata: { cambios, branchIdProveedor: branchIdAplicado, omitidos, errores },
      });

      return {
        aplicados: cambios.length,
        omitidos,
        rechazados: errores.length,
        sedeId: dto.sedeId,
        branchIdProveedor: branchIdAplicado,
        cambios,
        errores,
      };
    }, { timeout: 15000 });
  }

  /** Clasificador puro del diff entre serie local y serie proveedor */
  private clasificarDiff(params: {
    tipoDocumento: string;
    tipoDocumentoNombre: string;
    serieLocal: string | null;
    correlativoLocal: number | null;
    serieProveedor: string | null;
    correlativoProveedor: number | null;
    proximoNumeroProveedor: string | null;
    comprobantesEmitidosLocalmente: number;
    /** MAX(correlativo) en BD para la serie destino (en TODA la empresa).
     *  Si > correlativoProveedor, el sync produciría choque al emitir el siguiente. */
    maxCorrelativoBdEnSerieDestino?: number;
  }): DiffSerie {
    const {
      serieLocal, correlativoLocal,
      serieProveedor, correlativoProveedor,
      comprobantesEmitidosLocalmente,
      maxCorrelativoBdEnSerieDestino = 0,
    } = params;

    let accion: AccionDiff;
    let mensaje: string | undefined;

    if (!serieProveedor && !serieLocal) {
      accion = 'EN_SINCRONIA';
      mensaje = 'Sin serie configurada en ambos lados';
    } else if (!serieProveedor && serieLocal) {
      accion = 'NO_EMITIBLE';
      mensaje = `La serie local ${serieLocal} no existe en el proveedor — no se pueden emitir nuevos documentos de este tipo por API`;
    } else if (serieProveedor && !serieLocal) {
      accion = 'CREAR_NUEVA';
      mensaje = `Nueva serie ${serieProveedor} disponible en el proveedor`;
      // Aun creando nueva: si en la empresa hay otra sede con esa misma serie y un MAX > proveedor, advertir.
      if (maxCorrelativoBdEnSerieDestino > (correlativoProveedor ?? 0)) {
        accion = 'CONFLICTO';
        mensaje =
          `La empresa ya tiene comprobantes con serie ${serieProveedor} hasta correlativo ${maxCorrelativoBdEnSerieDestino} ` +
          `(probablemente en otra sede), pero el proveedor está en ${correlativoProveedor ?? 0}. ` +
          `Resuelva manualmente: use otra serie o alinee el contador del proveedor a ${maxCorrelativoBdEnSerieDestino}.`;
      }
    } else if (serieLocal !== serieProveedor) {
      accion = 'REEMPLAZAR_SERIE';
      mensaje = comprobantesEmitidosLocalmente > 0
        ? `Hay ${comprobantesEmitidosLocalmente} comprobante(s) emitidos con ${serieLocal}. Se conservan en BD; los nuevos irán a ${serieProveedor}`
        : `Cambio de ${serieLocal} a ${serieProveedor}`;
      if (maxCorrelativoBdEnSerieDestino > (correlativoProveedor ?? 0)) {
        accion = 'CONFLICTO';
        mensaje =
          `Cambio a ${serieProveedor} bloqueado: la empresa ya emitió hasta correlativo ${maxCorrelativoBdEnSerieDestino} ` +
          `con esa serie, pero el proveedor está en ${correlativoProveedor ?? 0}. Resuelva manualmente.`;
      }
    } else if ((correlativoLocal ?? 0) === (correlativoProveedor ?? 0)
        && maxCorrelativoBdEnSerieDestino <= (correlativoProveedor ?? 0)) {
      accion = 'EN_SINCRONIA';
    } else if ((correlativoLocal ?? 0) < (correlativoProveedor ?? 0)
        && maxCorrelativoBdEnSerieDestino <= (correlativoProveedor ?? 0)) {
      accion = 'ACTUALIZAR_CORRELATIVO';
      mensaje = `Correlativo proveedor adelantado: ${correlativoLocal} → ${correlativoProveedor}`;
    } else if (maxCorrelativoBdEnSerieDestino > (correlativoProveedor ?? 0)) {
      accion = 'CONFLICTO';
      mensaje =
        `BD tiene comprobantes ${serieProveedor}-${maxCorrelativoBdEnSerieDestino} pero proveedor está en ${correlativoProveedor ?? 0}. ` +
        `Aplicar bajaría el contador y produciría choque de unique constraint. Resuelva manualmente.`;
    } else {
      accion = 'CONFLICTO';
      mensaje = `Correlativo local (${correlativoLocal}) es mayor al del proveedor (${correlativoProveedor}). Resuelva manualmente antes de aplicar.`;
    }

    return {
      tipoDocumento: params.tipoDocumento,
      tipoDocumentoNombre: params.tipoDocumentoNombre,
      serieLocal,
      correlativoLocal,
      serieProveedor,
      correlativoProveedor,
      proximoNumeroProveedor: params.proximoNumeroProveedor,
      accion,
      mensaje,
      comprobantesEmitidosLocalmente,
    };
  }

}
