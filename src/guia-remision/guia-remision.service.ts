import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { NubefactProvider } from '../sunat/providers/nubefact.provider';
import { GreNubefactMapper } from '../sunat/providers/gre-nubefact.mapper';
import { FacturacionService } from '../sunat/facturacion.service';
import { FacturacionProviderFactory } from '../sunat/providers/facturacion-provider.factory';
import { EnvioResult } from '../sunat/facturacion-provider.interface';
import { CreateGuiaRemisionDto } from './dto/create-guia-remision.dto';
import { QueryGuiasRemisionDto } from './dto/query-guias-remision.dto';
import { Prisma } from '@prisma/client';
import { NubefactGreResponse } from '../sunat/providers/gre-nubefact.types';
import { NUBEFACT_TIMEOUT_MS } from '../sunat/providers/nubefact.types';

const MAX_INTENTOS_GRE = 10;
const ENVIO_BATCH_SIZE = 50;

/** Include completo para GuiaRemision */
const guiaFullInclude = {
  detalles: { include: { producto: { select: { id: true, nombre: true, codigoEmpresa: true } }, variante: { select: { id: true, nombre: true, sku: true } } } },
  documentosRelacionados: true,
  vehiculosSecundarios: true,
  conductoresSecundarios: true,
  sede: { select: { id: true, nombre: true, codigo: true, direccion: true, distrito: true, provincia: true, departamento: true, ubigeo: true } },
  venta: { select: { id: true, codigo: true } },
  compra: { select: { id: true, codigo: true } },
  transferencia: { select: { id: true, codigo: true } },
  devolucion: { select: { id: true, codigo: true } },
  creadoPor: { select: { id: true, email: true, persona: { select: { nombres: true, apellidos: true } } } },
} as const;

@Injectable()
export class GuiaRemisionService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nubefactProvider: NubefactProvider,
    private readonly facturacionService: FacturacionService,
    private readonly providerFactory: FacturacionProviderFactory,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('GuiaRemisionService');
  }

  // ── Crear guía ──

  async crear(empresaId: string, dto: CreateGuiaRemisionDto, usuarioId?: string) {
    // Validar items
    if (!dto.items?.length) {
      throw new BadRequestException('La guía debe tener al menos un item');
    }

    // Validar transporte
    if (dto.tipo === 'REMITENTE') {
      if (!dto.tipoTransporte) {
        throw new BadRequestException('Tipo de transporte es obligatorio para GRE Remitente');
      }
      if (dto.tipoTransporte === 'PUBLICO') {
        if (!dto.transportistaDocumentoNumero || !dto.transportistaDenominacion) {
          throw new BadRequestException('Datos del transportista son obligatorios para transporte público');
        }
      }
      if (dto.tipoTransporte === 'PRIVADO') {
        if (!dto.conductorDocumentoNumero || !dto.conductorNombre || !dto.conductorNumeroLicencia) {
          throw new BadRequestException('Datos del conductor son obligatorios para transporte privado');
        }
      }
      if (!dto.transportistaPlacaNumero && !dto.conductorDocumentoNumero) {
        throw new BadRequestException('Se requiere placa del vehículo');
      }
    }

    // Código temporal — correlativo real se asigna al enviar
    const codigoTemporal = `GRE-BORR-${Date.now().toString(36).toUpperCase()}`;

    // Auto-vincular comprobante electrónico si viene de una venta/compra
    const docsRelacionados = dto.documentosRelacionados || [];
    if (docsRelacionados.length === 0) {
      const comprobante = await this.buscarComprobanteVinculado(dto.ventaId, dto.compraId);
      if (comprobante) {
        docsRelacionados.push(comprobante);
      }
    }

    return this.prisma.guiaRemision.create({
      data: {
        empresaId,
        sedeId: dto.sedeId,
        tipo: dto.tipo as any,
        serie: '',
        correlativo: 0,
        codigoGenerado: codigoTemporal,
        estado: 'BORRADOR',
        fechaInicioTraslado: new Date(`${dto.fechaInicioTraslado}T12:00:00`),
        motivoTraslado: dto.motivoTraslado as any,
        motivoTrasladoOtrosDescripcion: dto.motivoTrasladoOtrosDescripcion,
        observaciones: dto.observaciones,
        pesoBrutoTotal: dto.pesoBrutoTotal,
        pesoBrutoUnidadMedida: dto.pesoBrutoUnidadMedida || 'KGM',
        numeroBultos: dto.numeroBultos,
        tipoTransporte: dto.tipoTransporte as any,
        clienteTipoDocumento: dto.clienteTipoDocumento,
        clienteNumeroDocumento: dto.clienteNumeroDocumento,
        clienteDenominacion: dto.clienteDenominacion,
        clienteDireccion: dto.clienteDireccion,
        clienteEmail: dto.clienteEmail,
        puntoPartidaUbigeo: dto.puntoPartidaUbigeo,
        puntoPartidaDireccion: dto.puntoPartidaDireccion,
        puntoPartidaCodigoEstablecimientoSunat: dto.puntoPartidaCodigoEstablecimientoSunat,
        puntoLlegadaUbigeo: dto.puntoLlegadaUbigeo,
        puntoLlegadaDireccion: dto.puntoLlegadaDireccion,
        puntoLlegadaCodigoEstablecimientoSunat: dto.puntoLlegadaCodigoEstablecimientoSunat,
        transportistaDocumentoTipo: dto.transportistaDocumentoTipo,
        transportistaDocumentoNumero: dto.transportistaDocumentoNumero,
        transportistaDenominacion: dto.transportistaDenominacion,
        transportistaPlacaNumero: dto.transportistaPlacaNumero,
        transportistaMtc: dto.transportistaMtc,
        conductorDocumentoTipo: dto.conductorDocumentoTipo,
        conductorDocumentoNumero: dto.conductorDocumentoNumero,
        conductorNombre: dto.conductorNombre,
        conductorApellidos: dto.conductorApellidos,
        conductorNumeroLicencia: dto.conductorNumeroLicencia,
        tucVehiculoPrincipal: dto.tucVehiculoPrincipal,
        sunatEnvioIndicador: dto.sunatEnvioIndicador,
        destinatarioDocumentoTipo: dto.destinatarioDocumentoTipo,
        destinatarioDocumentoNumero: dto.destinatarioDocumentoNumero,
        destinatarioDenominacion: dto.destinatarioDenominacion,
        documentoRelacionadoCodigo: dto.documentoRelacionadoCodigo,
        ventaId: dto.ventaId,
        compraId: dto.compraId,
        transferenciaId: dto.transferenciaId,
        devolucionId: dto.devolucionId,
        creadoPorId: usuarioId,
        detalles: {
          create: dto.items.map((item) => ({
            productoId: item.productoId,
            varianteId: item.varianteId,
            unidadMedida: item.unidadMedida,
            codigo: item.codigo,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            codigoDam: item.codigoDam,
          })),
        },
        documentosRelacionados: docsRelacionados.length
          ? {
              create: docsRelacionados.map((d) => ({
                tipo: d.tipo,
                serie: d.serie,
                numero: d.numero,
              })),
            }
          : undefined,
        vehiculosSecundarios: dto.vehiculosSecundarios?.length
          ? {
              create: dto.vehiculosSecundarios.slice(0, 2).map((v) => ({
                placaNumero: v.placaNumero,
                tuc: v.tuc,
              })),
            }
          : undefined,
        conductoresSecundarios: dto.conductoresSecundarios?.length
          ? {
              create: dto.conductoresSecundarios.slice(0, 2).map((c) => ({
                documentoTipo: c.documentoTipo,
                documentoNumero: c.documentoNumero,
                nombre: c.nombre,
                apellidos: c.apellidos,
                numeroLicencia: c.numeroLicencia,
              })),
            }
          : undefined,
      },
      include: guiaFullInclude,
    });
  }

  // ── Actualizar guía (BORRADOR o RECHAZADO) ──

  async actualizar(guiaId: string, empresaId: string, dto: Partial<CreateGuiaRemisionDto>) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { id: guiaId, empresaId },
    });
    if (!guia) throw new NotFoundException('Guía de remisión no encontrada');
    if (guia.estado === 'ACEPTADO' || guia.estado === 'ANULADO') {
      throw new BadRequestException('No se pueden editar guías aceptadas o anuladas');
    }

    // Construir datos de actualización (solo campos proporcionados)
    const data: any = {};
    if (dto.fechaInicioTraslado) data.fechaInicioTraslado = new Date(`${dto.fechaInicioTraslado}T12:00:00`);
    if (dto.motivoTraslado) data.motivoTraslado = dto.motivoTraslado;
    if (dto.observaciones !== undefined) data.observaciones = dto.observaciones;
    if (dto.pesoBrutoTotal) data.pesoBrutoTotal = dto.pesoBrutoTotal;
    if (dto.pesoBrutoUnidadMedida) data.pesoBrutoUnidadMedida = dto.pesoBrutoUnidadMedida;
    if (dto.numeroBultos !== undefined) data.numeroBultos = dto.numeroBultos;
    if (dto.tipoTransporte) data.tipoTransporte = dto.tipoTransporte;
    if (dto.clienteTipoDocumento) data.clienteTipoDocumento = dto.clienteTipoDocumento;
    if (dto.clienteNumeroDocumento) data.clienteNumeroDocumento = dto.clienteNumeroDocumento;
    if (dto.clienteDenominacion) data.clienteDenominacion = dto.clienteDenominacion;
    if (dto.clienteDireccion !== undefined) data.clienteDireccion = dto.clienteDireccion;
    if (dto.clienteEmail !== undefined) data.clienteEmail = dto.clienteEmail;
    if (dto.puntoPartidaUbigeo) data.puntoPartidaUbigeo = dto.puntoPartidaUbigeo;
    if (dto.puntoPartidaDireccion) data.puntoPartidaDireccion = dto.puntoPartidaDireccion;
    if (dto.puntoLlegadaUbigeo) data.puntoLlegadaUbigeo = dto.puntoLlegadaUbigeo;
    if (dto.puntoLlegadaDireccion) data.puntoLlegadaDireccion = dto.puntoLlegadaDireccion;
    if (dto.transportistaDocumentoTipo) data.transportistaDocumentoTipo = dto.transportistaDocumentoTipo;
    if (dto.transportistaDocumentoNumero) data.transportistaDocumentoNumero = dto.transportistaDocumentoNumero;
    if (dto.transportistaDenominacion) data.transportistaDenominacion = dto.transportistaDenominacion;
    if (dto.transportistaPlacaNumero) data.transportistaPlacaNumero = dto.transportistaPlacaNumero;
    if (dto.conductorDocumentoTipo) data.conductorDocumentoTipo = dto.conductorDocumentoTipo;
    if (dto.conductorDocumentoNumero) data.conductorDocumentoNumero = dto.conductorDocumentoNumero;
    if (dto.conductorNombre) data.conductorNombre = dto.conductorNombre;
    if (dto.conductorApellidos) data.conductorApellidos = dto.conductorApellidos;
    if (dto.conductorNumeroLicencia) data.conductorNumeroLicencia = dto.conductorNumeroLicencia;

    // Limpiar error y volver a BORRADOR para reenviar
    if (guia.estado !== 'BORRADOR') {
      data.estado = 'BORRADOR';
      data.sunatStatus = 'PENDIENTE';
      data.errorProveedor = null;
    }

    // Actualizar items si se proporcionan
    if (dto.items?.length) {
      // Eliminar items anteriores y crear nuevos
      await this.prisma.guiaRemisionDetalle.deleteMany({ where: { guiaRemisionId: guiaId } });
      await this.prisma.guiaRemisionDetalle.createMany({
        data: dto.items.map((item) => ({
          guiaRemisionId: guiaId,
          productoId: item.productoId,
          varianteId: item.varianteId,
          unidadMedida: item.unidadMedida,
          codigo: item.codigo,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
        })),
      });
    }

    return this.prisma.guiaRemision.update({
      where: { id: guiaId },
      data,
      include: guiaFullInclude,
    });
  }

  // ── Enviar a SUNAT via Nubefact ──

  async enviar(guiaId: string, empresaId: string) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { id: guiaId, empresaId },
      include: guiaFullInclude,
    });

    if (!guia) throw new NotFoundException('Guía de remisión no encontrada');
    if (guia.estado === 'ACEPTADO') throw new BadRequestException('La guía ya fue aceptada por SUNAT');
    if (guia.estado === 'ANULADO') throw new BadRequestException('La guía está anulada');
    if (guia.intentosEnvio >= MAX_INTENTOS_GRE) {
      throw new BadRequestException('Se alcanzó el máximo de intentos de envío');
    }

    // Obtener config de facturación
    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, guia.sedeId);
    if (!config.facturacionActiva) {
      throw new BadRequestException('Facturación electrónica no está activa');
    }
    if (!config.proveedorRuta || !config.proveedorToken) {
      throw new BadRequestException('Credenciales del proveedor de facturación no configuradas');
    }

    const provider = this.providerFactory.get(config.proveedorActivo);

    // ── Proveedor con soporte GRE nativo (Syncrofact): es el emisor y numera ──
    if (typeof provider.enviarGuiaRemision === 'function') {
      if (!guia.serie) {
        (guia as any).serie = await this.resolverSerieGuia(guia.sedeId!, guia.tipo);
      }
      let result: EnvioResult;
      try {
        result = await provider.enviarGuiaRemision(guia, config);
      } catch (error: any) {
        await this.prisma.guiaRemision.update({
          where: { id: guiaId },
          data: {
            estado: 'ENVIADO',
            sunatStatus: 'ERROR_COMUNICACION',
            errorProveedor: error?.message || 'Error de comunicación',
            intentosEnvio: { increment: 1 },
            ultimoIntentoEnvio: new Date(),
          },
        });
        throw new BadRequestException(error?.message || 'Error de comunicación con proveedor');
      }
      return this.persistirResultadoProveedor(guiaId, result, { incrementarIntento: true });
    }

    // ── Nubefact (legacy): Syncronize asigna la numeración ──
    // Asignar correlativo real si aún no tiene (borrador o rechazado sin correlativo)
    if (guia.correlativo === 0) {
      const { serie, correlativo, codigoGenerado } = await this.obtenerCorrelativo(
        empresaId,
        guia.sedeId!,
        guia.tipo,
      );
      await this.prisma.guiaRemision.update({
        where: { id: guiaId },
        data: { serie, correlativo, codigoGenerado },
      });
      // Actualizar objeto local
      (guia as any).serie = serie;
      (guia as any).correlativo = correlativo;
      (guia as any).codigoGenerado = codigoGenerado;
    }

    // Paso 1: generar_guia
    const body = GreNubefactMapper.toGreRequest(guia, config.entorno);

    let response: NubefactGreResponse;
    try {
      response = await this.callNubefactApi<NubefactGreResponse>(
        config.proveedorRuta,
        config.proveedorToken,
        body,
      );
    } catch (error: any) {
      await this.prisma.guiaRemision.update({
        where: { id: guiaId },
        data: {
          estado: 'ENVIADO',
          sunatStatus: 'ERROR_COMUNICACION',
          errorProveedor: error.message || 'Error de comunicación',
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
        },
      });
      throw new BadRequestException(error.message || 'Error de comunicación con proveedor');
    }

    // Log completo para debugging
    this.logger.info('Nubefact GRE request', { serie: body.serie, numero: body.numero, motivo: body.motivo_de_traslado });
    this.logger.info('Nubefact GRE response RAW', { response: JSON.stringify(response) });

    const rawResponse = response as any;
    const errorMsg = rawResponse.sunat_description || rawResponse.sunat_soap_error || rawResponse.errors || rawResponse.message || '';
    const esBeta = config.entorno === 'BETA';
    const aceptada = response.aceptada_por_sunat === true;
    const tieneEnlace = !!response.enlace;

    // GRE en Nubefact: generar_guia NO genera PDF inmediato
    // Se debe consultar después con consultar_guia
    if (aceptada || (esBeta && tieneEnlace)) {
      const mapped = GreNubefactMapper.fromGreResponse(response);
      await this.prisma.guiaRemision.update({
        where: { id: guiaId },
        data: {
          estado: 'ACEPTADO',
          sunatStatus: 'ACEPTADO',
          ...mapped,
          errorProveedor: null,
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
        },
      });
      return { status: 'ACEPTADO', ...mapped };
    }

    // GRE: generar_guia normalmente devuelve aceptada_por_sunat=false sin errores
    // Esto significa que SUNAT aún no respondió → PROCESANDO
    const sinErrores = !errorMsg || typeof errorMsg !== 'string' || errorMsg.trim() === '';

    if (sinErrores) {
      // Sin errores = enviado correctamente, esperando SUNAT
      const mapped = GreNubefactMapper.fromGreResponse(response);
      await this.prisma.guiaRemision.update({
        where: { id: guiaId },
        data: {
          estado: 'ENVIADO',
          sunatStatus: 'PROCESANDO',
          ...mapped,
          errorProveedor: null,
          intentosEnvio: { increment: 1 },
          ultimoIntentoEnvio: new Date(),
        },
      });
      return { status: 'PROCESANDO', message: 'Guía enviada a SUNAT. Consulte el estado en unos segundos.' };
    }

    // Con errores → Rechazado
    const errorStr = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
    await this.prisma.guiaRemision.update({
      where: { id: guiaId },
      data: {
        estado: 'RECHAZADO',
        sunatStatus: 'RECHAZADO',
        errorProveedor: errorStr,
        intentosEnvio: { increment: 1 },
        ultimoIntentoEnvio: new Date(),
      },
    });
    return { status: 'RECHAZADO', error: errorStr };
  }

  // ── Consultar estado (Paso 2: consultar_guia) ──

  async consultar(guiaId: string, empresaId: string) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { id: guiaId, empresaId },
    });
    if (!guia) throw new NotFoundException('Guía de remisión no encontrada');

    const config = await this.facturacionService.getConfigFacturacionEfectiva(empresaId, guia.sedeId);
    const provider = this.providerFactory.get(config.proveedorActivo);

    // ── Proveedor con soporte GRE nativo (Syncrofact) ──
    if (typeof provider.consultarGuiaRemision === 'function') {
      try {
        const result = await provider.consultarGuiaRemision(guia, config);
        return this.persistirResultadoProveedor(guiaId, result, { incrementarIntento: false });
      } catch (error: any) {
        throw new BadRequestException(error?.message || 'Error al consultar la guía');
      }
    }

    // ── Nubefact (legacy) — envuelto para no propagar un 500 ──
    try {
      const body = GreNubefactMapper.toConsultaRequest(guia, config.entorno);
      const response = await this.callNubefactApi<NubefactGreResponse>(
        config.proveedorRuta,
        config.proveedorToken,
        body,
      );

      if (response.aceptada_por_sunat === true || response.enlace) {
        const mapped = GreNubefactMapper.fromGreResponse(response);
        await this.prisma.guiaRemision.update({
          where: { id: guiaId },
          data: {
            estado: 'ACEPTADO',
            sunatStatus: 'ACEPTADO',
            ...mapped,
            errorProveedor: null,
          },
        });
        return { status: 'ACEPTADO', ...mapped };
      }

      return { status: 'PROCESANDO', message: 'SUNAT aún no ha respondido' };
    } catch (error: any) {
      throw new BadRequestException(error?.message || 'Error al consultar la guía');
    }
  }

  // ── Enviar y consultar (2 pasos en uno) ──

  async enviarYConsultar(guiaId: string, empresaId: string) {
    const envioResult = await this.enviar(guiaId, empresaId);

    // Si quedó en PROCESANDO, intentar consultar con reintentos
    if (envioResult.status === 'PROCESANDO') {
      // SUNAT puede tardar segundos o minutos. Intentamos 2 veces con espera.
      for (let intento = 0; intento < 2; intento++) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 segundos
        const consultaResult = await this.consultar(guiaId, empresaId);
        if (consultaResult.status === 'ACEPTADO') {
          return consultaResult;
        }
      }
      // Si no fue aceptado aún, devolver PROCESANDO para que consulte manualmente
      return { status: 'PROCESANDO', message: 'Guía enviada. SUNAT aún no responde. Use "Consultar Estado" en unos minutos.' };
    }

    return envioResult;
  }

  // ── Listar guías ──

  async listar(empresaId: string, query: QueryGuiasRemisionDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.GuiaRemisionWhereInput = { empresaId };

    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.tipo) where.tipo = query.tipo as any;
    if (query.estado) where.estado = query.estado as any;
    if (query.sunatStatus) where.sunatStatus = query.sunatStatus as any;
    if (query.motivoTraslado) where.motivoTraslado = query.motivoTraslado as any;

    if (query.fechaDesde || query.fechaHasta) {
      where.fechaEmision = {};
      if (query.fechaDesde) where.fechaEmision.gte = new Date(`${query.fechaDesde}T00:00:00`);
      if (query.fechaHasta) where.fechaEmision.lte = new Date(`${query.fechaHasta}T23:59:59.999`);
    }

    if (query.busqueda) {
      where.OR = [
        { codigoGenerado: { contains: query.busqueda, mode: 'insensitive' } },
        { clienteDenominacion: { contains: query.busqueda, mode: 'insensitive' } },
        { clienteNumeroDocumento: { contains: query.busqueda } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.guiaRemision.findMany({
        where,
        include: {
          sede: { select: { id: true, nombre: true, codigo: true } },
          detalles: { select: { id: true, descripcion: true, cantidad: true } },
          venta: { select: { id: true, codigo: true } },
          compra: { select: { id: true, codigo: true } },
          transferencia: { select: { id: true, codigo: true } },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.guiaRemision.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Prefill desde venta ──

  async prefillDesdeVenta(ventaId: string, empresaId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      include: {
        detalles: {
          select: {
            productoId: true,
            varianteId: true,
            descripcion: true,
            cantidad: true,
            producto: { select: { nombre: true, codigoEmpresa: true, sku: true, peso: true, unidadMedida: { select: { codigoPersonalizado: true, simboloPersonalizado: true } } } },
            variante: { select: { nombre: true, sku: true } },
          },
        },
        sede: { select: { id: true, nombre: true, direccion: true, direccionFiscalSede: true, ubigeo: true, distrito: true, provincia: true, departamento: true } },
        clienteEmpresa: { select: { id: true, razonSocial: true, numeroDocumento: true, tipoDocumento: true, direccion: true, ciudad: true, distrito: true, provincia: true, departamento: true, ubigeo: true, email: true } },
        comprobante: { select: { tipoComprobante: true, serie: true, correlativo: true, estado: true } },
      },
    });

    if (!venta) throw new NotFoundException('Venta no encontrada');

    // Empresa para datos de partida fallback
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ruc: true, razonSocial: true, direccionFiscal: true, ubigeo: true },
    });

    // Punto de partida: Sede > Empresa
    const sede = venta.sede;
    const puntoPartidaUbigeo = sede?.ubigeo || empresa?.ubigeo || '';
    const puntoPartidaDireccion = sede?.direccionFiscalSede || sede?.direccion || empresa?.direccionFiscal || '';

    // Destinatario y punto de llegada
    const ce = venta.clienteEmpresa;
    // Detectar tipo documento: ClienteEmpresa > longitud documento > default RUC
    let tipoDoc = '6';
    if (ce?.tipoDocumento === 'DNI') {
      tipoDoc = '1';
    } else if (ce?.tipoDocumento === 'RUC') {
      tipoDoc = '6';
    } else {
      const doc = ce?.numeroDocumento || venta.documentoCliente || '';
      tipoDoc = doc.length === 8 ? '1' : doc.length === 11 ? '6' : '6';
    }
    const direccionCompleta = ce
      ? [ce.direccion, ce.distrito, ce.provincia, ce.departamento].filter(Boolean).join(', ')
      : venta.direccionCliente || '';

    // Comprobante relacionado
    let documentoRelacionado: { tipo: string; serie: string; numero: number } | null = null;
    if (venta.comprobante && venta.comprobante.estado !== 'ANULADO') {
      documentoRelacionado = {
        tipo: venta.comprobante.tipoComprobante === 'FACTURA' ? '01' : '03',
        serie: venta.comprobante.serie,
        numero: parseInt(venta.comprobante.correlativo, 10) || 0,
      };
    }

    // Items desde detalles de venta — solo campos necesarios para la GRE
    let pesoEstimado = 0;
    const items = venta.detalles.map((d: any) => {
      const pesoUnitario = d.producto?.peso ? Number(d.producto.peso) : 0;
      const cant = Number(d.cantidad);
      pesoEstimado += pesoUnitario * cant;
      return {
        productoId: d.productoId || null,
        varianteId: d.varianteId || null,
        descripcion: d.producto?.nombre
          ? (d.variante?.nombre ? `${d.producto.nombre} - ${d.variante.nombre}` : d.producto.nombre)
          : d.descripcion || 'Producto',
        codigo: d.producto?.codigoEmpresa || d.producto?.sku || '',
        cantidad: cant,
        unidadMedida: d.producto?.unidadMedida?.codigoPersonalizado || d.producto?.unidadMedida?.simboloPersonalizado || 'NIU',
      };
    });

    return {
      ventaId: venta.id,
      ventaCodigo: venta.codigo,
      sedeId: sede?.id,
      sedeNombre: sede?.nombre,

      // Destinatario
      clienteTipoDocumento: tipoDoc,
      clienteNumeroDocumento: ce?.numeroDocumento || venta.documentoCliente || '',
      clienteDenominacion: ce?.razonSocial || venta.nombreCliente,
      clienteDireccion: direccionCompleta,
      clienteEmail: ce?.email || venta.emailCliente || '',

      // Punto de partida
      puntoPartidaUbigeo,
      puntoPartidaDireccion,

      // Punto de llegada
      puntoLlegadaUbigeo: ce?.ubigeo || '',
      puntoLlegadaDireccion: direccionCompleta,

      // Documento relacionado
      documentoRelacionado,

      // Items
      items,

      // Peso estimado
      pesoBrutoEstimado: pesoEstimado > 0 ? pesoEstimado : 1,
      totalItems: items.length,
    };
  }

  // ── Obtener detalle ──

  async obtener(guiaId: string, empresaId: string) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { id: guiaId, empresaId },
      include: guiaFullInclude,
    });
    if (!guia) throw new NotFoundException('Guía de remisión no encontrada');
    return guia;
  }

  // ── Enviar pendientes masivo ──

  async enviarPendientes(empresaId: string) {
    const pendientes = await this.prisma.guiaRemision.findMany({
      where: {
        empresaId,
        estado: { in: ['BORRADOR', 'ENVIADO', 'RECHAZADO'] },
        sunatStatus: { in: ['PENDIENTE', 'ERROR_COMUNICACION', 'PROCESANDO'] },
        intentosEnvio: { lt: MAX_INTENTOS_GRE },
      },
      select: { id: true },
      take: ENVIO_BATCH_SIZE,
    });

    const resultados = { enviados: 0, errores: 0, total: pendientes.length };

    for (const { id } of pendientes) {
      try {
        await this.enviarYConsultar(id, empresaId);
        resultados.enviados++;
      } catch {
        resultados.errores++;
      }
    }

    return resultados;
  }

  // ── Ubigeos ──

  private _ubigeosCache: any[] | null = null;

  getUbigeos() {
    if (!this._ubigeosCache) {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, 'ubigeos.json');
      this._ubigeosCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    return this._ubigeosCache;
  }

  // ── CRUD Vehículos de la empresa ──

  async listarVehiculos(empresaId: string) {
    return this.prisma.vehiculoEmpresa.findMany({
      where: { empresaId, isActive: true },
      orderBy: { placaNumero: 'asc' },
    });
  }

  async crearVehiculo(empresaId: string, data: { placaNumero: string; marca?: string; modelo?: string; tipo?: string; capacidadTM?: number; tuc?: string }) {
    return this.prisma.vehiculoEmpresa.create({
      data: { empresaId, ...data },
    });
  }

  async actualizarVehiculo(empresaId: string, vehiculoId: string, data: any) {
    return this.prisma.vehiculoEmpresa.update({
      where: { id: vehiculoId },
      data,
    });
  }

  // ── CRUD Conductores de la empresa ──

  async listarConductores(empresaId: string) {
    return this.prisma.conductorEmpresa.findMany({
      where: { empresaId, isActive: true },
      orderBy: { apellidos: 'asc' },
    });
  }

  async crearConductor(empresaId: string, data: { tipoDocumento?: string; numeroDocumento: string; nombre: string; apellidos: string; numeroLicencia: string; categoriaLicencia?: string; empleadoId?: string }) {
    return this.prisma.conductorEmpresa.create({
      data: { empresaId, tipoDocumento: data.tipoDocumento || '1', ...data },
    });
  }

  async actualizarConductor(empresaId: string, conductorId: string, data: any) {
    return this.prisma.conductorEmpresa.update({
      where: { id: conductorId },
      data,
    });
  }

  // ── CRUD Transportistas ──

  async listarTransportistas(empresaId: string) {
    return this.prisma.transportistaEmpresa.findMany({
      where: { empresaId, isActive: true },
      orderBy: { razonSocial: 'asc' },
    });
  }

  async crearTransportista(empresaId: string, data: { ruc: string; razonSocial: string; direccion?: string; telefono?: string; email?: string; registroMtc?: string }) {
    return this.prisma.transportistaEmpresa.create({
      data: { empresaId, ...data },
    });
  }

  async actualizarTransportista(empresaId: string, transportistaId: string, data: any) {
    return this.prisma.transportistaEmpresa.update({
      where: { id: transportistaId },
      data,
    });
  }

  // ── Privados ──

  /**
   * Busca el comprobante electrónico (factura/boleta) vinculado a una venta o compra
   * y retorna los datos para documento_relacionado de la GRE.
   */
  private async buscarComprobanteVinculado(
    ventaId?: string,
    compraId?: string,
  ): Promise<{ tipo: string; serie: string; numero: number } | null> {
    if (ventaId) {
      const comprobante = await this.prisma.comprobanteElectronico.findUnique({
        where: { ventaId },
        select: { tipoComprobante: true, serie: true, correlativo: true, estado: true },
      });
      if (comprobante && comprobante.estado !== 'ANULADO') {
        // Nubefact: 01=Factura, 03=Boleta
        const tipoDoc = comprobante.tipoComprobante === 'FACTURA' ? '01' : '03';
        return {
          tipo: tipoDoc,
          serie: comprobante.serie,
          numero: parseInt(comprobante.correlativo, 10) || 0,
        };
      }
    }

    if (compraId) {
      // Las compras referencian el documento del proveedor (factura de compra)
      const compra = await this.prisma.compra.findUnique({
        where: { id: compraId },
        select: { serieDocumentoProveedor: true, numeroDocumentoProveedor: true, tipoDocumentoProveedor: true },
      });
      if (compra?.serieDocumentoProveedor && compra?.numeroDocumentoProveedor) {
        return {
          tipo: '01', // Factura del proveedor
          serie: compra.serieDocumentoProveedor,
          numero: parseInt(compra.numeroDocumentoProveedor, 10) || 0,
        };
      }
    }

    return null;
  }

  /**
   * Persiste el resultado genérico de un proveedor GRE nativo (Syncrofact) en
   * la GuiaRemision. Extrae numero_completo del rawResponse cuando viene, mapea
   * estado y URLs, y devuelve un payload uniforme para el controller.
   */
  private async persistirResultadoProveedor(
    guiaId: string,
    result: EnvioResult,
    opts: { incrementarIntento?: boolean } = {},
  ) {
    const raw: any = result.rawResponse;
    const numeroCompleto: string | undefined = raw?.data?.numero_completo;

    const data: any = {
      sunatHash: result.hash ?? undefined,
      sunatXmlUrl: result.xmlUrl ?? undefined,
      sunatPdfUrl: result.pdfUrl ?? undefined,
      sunatCdrUrl: result.cdrUrl ?? undefined,
      cadenaQR: result.cadenaQR ?? undefined,
      enlaceProveedor: result.enlace ?? undefined,
    };

    // Syncrofact es el emisor: tomamos la numeración oficial que devuelve
    if (numeroCompleto && numeroCompleto.includes('-')) {
      const [serie, corr] = numeroCompleto.split('-');
      data.serie = serie;
      data.correlativo = parseInt(corr, 10) || 0;
      data.codigoGenerado = numeroCompleto;
    }

    if (opts.incrementarIntento) {
      data.intentosEnvio = { increment: 1 };
      data.ultimoIntentoEnvio = new Date();
    }

    let status: string;
    if (result.aceptado) {
      data.estado = 'ACEPTADO';
      data.sunatStatus = 'ACEPTADO';
      data.errorProveedor = null;
      status = 'ACEPTADO';
    } else if (result.procesando) {
      data.estado = 'ENVIADO';
      data.sunatStatus = 'PROCESANDO';
      data.errorProveedor = null;
      status = 'PROCESANDO';
    } else {
      data.estado = 'RECHAZADO';
      data.sunatStatus = 'RECHAZADO';
      data.errorProveedor = result.error || 'Rechazado por SUNAT';
      status = 'RECHAZADO';
    }

    const updated = await this.prisma.guiaRemision.update({
      where: { id: guiaId },
      data,
      select: { sedeId: true },
    });

    // Syncrofact asigna la numeración oficial de la GRE, pero el contador local
    // de la sede (ultimoNumeroGuiaRemision) no avanza por su cuenta → la
    // "Sincronizar series" marcaba drift falso (proveedor siempre 1 adelante,
    // bucle infinito N→N+1). Al aceptar, espejamos el correlativo del proveedor
    // en el contador local (solo avanza, nunca retrocede).
    if (
      status === 'ACEPTADO' &&
      typeof data.correlativo === 'number' &&
      data.correlativo > 0 &&
      updated.sedeId
    ) {
      await this.prisma.sede.updateMany({
        where: {
          id: updated.sedeId,
          ultimoNumeroGuiaRemision: { lt: data.correlativo },
        },
        data: { ultimoNumeroGuiaRemision: data.correlativo },
      });
    }

    if (status === 'ACEPTADO') {
      return { status, numeroCompleto, pdfUrl: result.pdfUrl, enlace: result.enlace };
    }
    if (status === 'PROCESANDO') {
      return { status, message: 'Guía enviada a SUNAT. Consulte el estado en unos segundos.' };
    }
    return { status, error: result.error };
  }

  /**
   * Resuelve la serie de guía de la sede SIN incrementar el contador local
   * (cuando el proveedor es el emisor y asigna el correlativo oficial).
   */
  private async resolverSerieGuia(sedeId: string, tipo: string): Promise<string> {
    const sede = await this.prisma.sede.findUnique({
      where: { id: sedeId },
      select: { serieGuiaRemision: true },
    });
    let serie = sede?.serieGuiaRemision || 'T001';
    if (tipo === 'TRANSPORTISTA' && serie.startsWith('T')) {
      serie = serie.replace(/^T/, 'V');
    }
    return serie;
  }

  private async obtenerCorrelativo(empresaId: string, sedeId: string, tipo: string) {
    // Incremento atómico del correlativo en la sede
    const sede = await this.prisma.sede.update({
      where: { id: sedeId },
      data: { ultimoNumeroGuiaRemision: { increment: 1 } },
      select: { serieGuiaRemision: true, ultimoNumeroGuiaRemision: true },
    });

    // La serie de la sede puede ser T001 o V001 según tipo
    let serie = sede.serieGuiaRemision || 'T001';
    if (tipo === 'TRANSPORTISTA' && serie.startsWith('T')) {
      serie = serie.replace(/^T/, 'V');
    }

    const correlativo = sede.ultimoNumeroGuiaRemision;
    const codigoGenerado = `${serie}-${String(correlativo).padStart(8, '0')}`;

    return { serie, correlativo, codigoGenerado };
  }

  private async callNubefactApi<T = any>(ruta: string, token: string, body: any): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NUBEFACT_TIMEOUT_MS);

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
        throw new Error('Timeout: proveedor de facturación no respondió');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Respuesta no válida del proveedor: HTTP ${response.status} ${response.statusText}`);
    }

    // Nubefact puede devolver errores como parte del response
    if (data.aceptada_por_sunat !== undefined || data.enlace || data.sunat_description) {
      return data as T;
    }

    if (!response.ok) {
      const msg = data?.errors || data?.message || `HTTP ${response.status}`;
      const errorStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
      this.logger.warn('Error Nubefact GRE', { status: response.status, error: errorStr });
      throw new Error(errorStr);
    }

    // Respuesta sin campos esperados pero con nota_importante (primera vez generar_guia)
    if (data.nota_importante) {
      return data as T;
    }

    return data as T;
  }
}
