import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { NubefactMapper } from './nubefact.mapper';
import {
  NubefactComprobanteResponse,
  NubefactAnulacionResponse,
  TIPO_COMPROBANTE_MAP,
} from './nubefact.types';
import { CrearNotaDto } from './dto/crear-nota.dto';
import { ConfiguracionFacturacionDto } from './dto/configuracion-facturacion.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class NubefactService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('NubefactService');
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
   * - Nubefact credentials → Sede > ConfigFacturacion
   * - IGV, entorno, resolucion → ConfigFacturacion (billing-only)
   * - textoPiePagina → ConfigFacturacion
   */
  async getConfigFacturacionEfectiva(empresaId: string, sedeId?: string | null) {
    const [config, sede, empresa, configDoc] = await Promise.all([
      this.prisma.configuracionFacturacion.findUnique({
        where: { empresaId },
        select: {
          nubefactRuta: true, nubefactToken: true, nubefactActivo: true,
          entorno: true, porcentajeIGV: true, resolucionSunat: true,
          emailFacturacion: true, textoPiePagina: true,
        },
      }),
      sedeId
        ? this.prisma.sede.findFirst({
            where: { id: sedeId, empresaId },
            select: {
              rucSede: true, razonSocialSede: true, direccionFiscalSede: true,
              nubefactRuta: true, nubefactToken: true, nubefactActivo: true,
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
      // Nubefact: Sede > ConfigFacturacion
      nubefactRuta:     sede?.nubefactRuta          ?? config?.nubefactRuta   ?? null,
      nubefactToken:    sede?.nubefactToken         ?? config?.nubefactToken  ?? null,
      nubefactActivo:   sede?.nubefactActivo        ?? config?.nubefactActivo ?? false,
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
        select: { nubefactActivo: true },
      }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { ruc: true, razonSocial: true, nombre: true },
      }),
      this.prisma.sede.findMany({
        where: { empresaId, rucSede: { not: null }, isActive: true },
        select: { id: true, nombre: true, rucSede: true, razonSocialSede: true, nubefactActivo: true },
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
        activo: config?.nubefactActivo ?? false,
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
        activo: sede.nubefactActivo ?? false,
      });
    }

    return emisores;
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
          nubefactEnviado: true,
          nubefactError: true,
          intentosEnvio: true,
          enlaceNubefact: true,
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
        intentosEnvio: { lt: 10 },
      },
      select: { id: true, codigoGenerado: true },
      orderBy: { fechaEmision: 'desc' },
      take: 50,
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

  // ── Core: Enviar comprobante a Nubefact ──

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
          venta: { select: { sedeId: true } },
        },
      });

      if (!comprobante) {
        this.logger.warn(`Comprobante ${comprobanteId} no encontrado`);
        return;
      }

      // Resolver sedeId: del comprobante directo, o de la venta asociada
      const sedeId = comprobante.sedeId || comprobante.venta?.sedeId || null;

      const credenciales = await this.getCredenciales(empresaId, sedeId);
      if (!credenciales) {
        this.logger.log(`Nubefact no configurado/activo para empresa ${empresaId}, omitiendo envío`);
        return;
      }

      const config = await this.getConfigFacturacionEfectiva(empresaId, sedeId);

      const body = NubefactMapper.toNubefactRequest(
        comprobante as any,
        config as any,
        comprobante.comprobanteOrigen as any,
      );

      this.logger.log(`Enviando comprobante ${comprobante.codigoGenerado} a Nubefact`);

      const response = await this.callNubefact<NubefactComprobanteResponse>(
        credenciales.ruta,
        credenciales.token,
        body,
      );

      // Determinar si fue aceptado:
      // - aceptada_por_sunat === true → aceptado
      // - Tiene enlace (doc creado en Nubefact) → aceptado (en demo aceptada_por_sunat puede ser false)
      const fueAceptado = response.aceptada_por_sunat === true || !!response.enlace;

      if (fueAceptado) {
        const updateData = NubefactMapper.fromNubefactResponse(response);
        await this.prisma.comprobanteElectronico.update({
          where: { id: comprobanteId },
          data: {
            ...updateData,
            sunatStatus: 'ACEPTADO',
            estado: 'ACEPTADO',
            intentosEnvio: { increment: 1 },
            ultimoIntentoEnvio: new Date(),
          },
        });
        this.logger.log(`Comprobante ${comprobante.codigoGenerado} ACEPTADO por SUNAT`);
      } else {
        const errorMsg = response.sunat_description || response.sunat_soap_error || '';
        // "ya existe en NubeFacT" = el doc fue creado antes, marcar como aceptado
        if (errorMsg.toLowerCase().includes('ya existe')) {
          await this.prisma.comprobanteElectronico.update({
            where: { id: comprobanteId },
            data: {
              sunatStatus: 'ACEPTADO',
              estado: 'ACEPTADO',
              nubefactEnviado: true,
              cdrResponse: response as any,
              intentosEnvio: { increment: 1 },
              ultimoIntentoEnvio: new Date(),
            },
          });
          this.logger.log(`Comprobante ${comprobante.codigoGenerado} ya existía en Nubefact, marcado como ACEPTADO`);
        } else {
          await this.prisma.comprobanteElectronico.update({
            where: { id: comprobanteId },
            data: {
              sunatStatus: 'RECHAZADO',
              estado: 'RECHAZADO',
              nubefactEnviado: true,
              nubefactError: errorMsg || 'Rechazado por SUNAT',
              cdrResponse: response as any,
              intentosEnvio: { increment: 1 },
              ultimoIntentoEnvio: new Date(),
            },
          });
          this.logger.warn(`Comprobante ${comprobante.codigoGenerado} RECHAZADO: ${errorMsg}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`Error enviando comprobante ${comprobanteId}: ${error.message}`);
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobanteId },
        data: {
          sunatStatus: 'ERROR_COMUNICACION',
          nubefactError: error.message,
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
        nubefactError: true, intentosEnvio: true,
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

    const credenciales = await this.getCredenciales(empresaId, comprobante.sedeId);
    if (!credenciales) throw new BadRequestException('Nubefact no configurado');
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    const body = NubefactMapper.toConsultaRequest(
      comprobante as any,
      'consultar_comprobante',
      credenciales.entorno,
    );

    const response = await this.callNubefact(credenciales.ruta, credenciales.token, body);

    // Actualizar estado con datos completos de la respuesta
    if (response.aceptada_por_sunat === true || response.enlace) {
      const updateData = NubefactMapper.fromNubefactResponse(response);
      await this.prisma.comprobanteElectronico.update({
        where: { id: comprobanteId },
        data: {
          ...updateData,
          sunatStatus: 'ACEPTADO',
          estado: 'ACEPTADO',
        },
      });
    }

    return response;
  }

  // ── Anular comprobante ──

  async anularComprobante(comprobanteId: string, empresaId: string, motivo: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');
    if (comprobante.anulado) throw new BadRequestException('El comprobante ya está anulado');

    const credenciales = await this.getCredenciales(empresaId, comprobante.sedeId);
    if (!credenciales) throw new BadRequestException('Nubefact no configurado');

    const body = NubefactMapper.toAnulacionRequest(
      comprobante as any,
      motivo,
      credenciales.entorno,
    );

    const response = await this.callNubefact<NubefactAnulacionResponse>(
      credenciales.ruta,
      credenciales.token,
      body,
    );

    await this.prisma.comprobanteElectronico.update({
      where: { id: comprobanteId },
      data: {
        anulado: true,
        motivoAnulacion: motivo,
        estado: 'ANULADO',
        cdrResponse: response as any,
      },
    });

    return response;
  }

  // ── Consultar anulación ──

  async consultarAnulacion(comprobanteId: string, empresaId: string): Promise<any> {
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: { id: comprobanteId, empresaId },
      select: { id: true, tipoComprobante: true, serie: true, correlativo: true, sedeId: true },
    });
    if (!comprobante) throw new NotFoundException('Comprobante no encontrado');

    const credenciales = await this.getCredenciales(empresaId, comprobante.sedeId);
    if (!credenciales) throw new BadRequestException('Nubefact no configurado');

    const body = NubefactMapper.toConsultaRequest(
      comprobante as any,
      'consultar_anulacion',
      credenciales.entorno,
    );

    return this.callNubefact(credenciales.ruta, credenciales.token, body);
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

  async updateConfiguracion(empresaId: string, dto: ConfiguracionFacturacionDto) {
    return this.prisma.configuracionFacturacion.upsert({
      where: { empresaId },
      update: { ...dto },
      create: { empresaId, ...dto },
    });
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
      // Lock sede para serie/correlativo
      // Nubefact: serie de nota debe empezar con mismo prefijo que doc original (B=boleta, F=factura)
      const campoUltimo = tipoNota === 'NOTA_CREDITO' ? 'ultimoNumeroNotaCredito' : 'ultimoNumeroNotaDebito';

      const [sedeLocked] = await tx.$queryRaw<any[]>`
        SELECT id, "${Prisma.raw(campoUltimo)}" as ultimo
        FROM "Sede" WHERE id = ${dto.sedeId} AND "empresaId" = ${empresaId} FOR UPDATE
      `;
      if (!sedeLocked) throw new BadRequestException('Sede no encontrada o no pertenece a esta empresa');

      // Serie: BN01 para notas de boleta, FN01 para notas de factura
      // (prefijo B/F requerido por Nubefact + N para distinguir de boletas/facturas regulares)
      const esFactura = origen.tipoComprobante === 'FACTURA';
      const prefijo = esFactura ? 'F' : 'B';
      const sufijo = tipoNota === 'NOTA_CREDITO' ? 'C01' : 'D01';
      const serie = `${prefijo}${sufijo}`;

      const nuevoCorrelativo = (sedeLocked.ultimo || 0) + 1;
      const correlativo = String(nuevoCorrelativo).padStart(8, '0');
      const codigoGenerado = `${serie}-${correlativo}`;

      await tx.sede.update({
        where: { id: dto.sedeId },
        data: { [campoUltimo]: nuevoCorrelativo },
      });

      // Items: usar del DTO o copiar del original
      const itemsOrigen = dto.items && dto.items.length > 0
        ? dto.items.map((item) => ({
            descripcion: item.descripcion,
            cantidad: new Prisma.Decimal(item.cantidad),
            valorUnitario: new Prisma.Decimal(item.valorUnitario.toFixed(2)),
            precioUnitario: new Prisma.Decimal(item.precioUnitario.toFixed(2)),
            tipoAfectacion: item.tipoAfectacion || '10',
            igv: new Prisma.Decimal((item.igv || 0).toFixed(2)),
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
      // Fire-after-commit: enviar a Nubefact
      this.enviarComprobante(nota.id, empresaId)
        .catch((err) => this.logger.warn(`Nubefact nota envio fallido: ${err?.message}`));
      return nota;
    });
  }

  private async getCredenciales(empresaId: string, sedeId?: string | null): Promise<{ ruta: string; token: string; entorno: string } | null> {
    const config = await this.getConfigFacturacionEfectiva(empresaId, sedeId);

    if (!config.nubefactActivo || !config.nubefactRuta || !config.nubefactToken) {
      return null;
    }

    return {
      ruta: config.nubefactRuta,
      token: config.nubefactToken,
      entorno: config.entorno,
    };
  }

  private async callNubefact<T = any>(ruta: string, token: string, body: any): Promise<T> {
    // Timeout de 30 segundos
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(ruta, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Timeout: Nubefact no respondió en 30 segundos');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    // Parsear JSON de forma segura
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Respuesta no válida de Nubefact: HTTP ${response.status} ${response.statusText}`);
    }

    // Si Nubefact devuelve un response con campos SUNAT, retornar para procesar
    if (data.aceptada_por_sunat !== undefined || data.enlace || data.sunat_description || data.codigo_hash) {
      return data as T;
    }

    // Error real de API (auth, formato, etc)
    if (!response.ok) {
      const msg = data?.errors || data?.message || `HTTP ${response.status}`;
      if (typeof msg === 'string' && msg.toLowerCase().includes('ya existe')) {
        return { ...data, sunat_description: msg } as T;
      }
      throw new Error(msg);
    }

    return data as T;
  }
}
