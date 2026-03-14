import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { UpdateConfigProductosDto } from './dto/update-config-productos.dto';
import { UpdateConfigVariantesDto } from './dto/update-config-variantes.dto';
import { UpdateConfigVentasDto } from './dto/update-config-ventas.dto';
import {
  PreviewCodigoDto,
  PreviewCodigoResponseDto,
  TipoCodigo,
} from './dto/preview-codigo.dto';
import { ConfiguracionResponseDto } from './dto/configuracion-response.dto';

/**
 * ConfiguracionCodigosService
 *
 * SERVICIO CENTRALIZADO para:
 * 1. Gestionar configuración de nomenclaturas personalizadas por empresa
 * 2. GENERAR códigos únicos para productos, variantes, servicios y documentos
 * 3. Prevenir race conditions mediante transacciones atómicas
 * 4. Sincronizar contadores con el estado real de la BD
 *
 * Este servicio REEMPLAZA los métodos de generación dispersos en:
 * - ProductoCatalogService
 * - ProductoComboService
 * - ProductoVarianteService
 */
@Injectable()
export class ConfiguracionCodigosService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ConfiguracionCodigosService.name);
  }

  // =====================================================
  // TRANSACCIONES SERIALIZABLES CON RETRY
  // =====================================================

  /**
   * Ejecuta una función dentro de una transacción Serializable con reintentos.
   * PostgreSQL puede lanzar serialization failures cuando dos transacciones
   * concurrentes colisionan. Este wrapper reintenta automáticamente.
   */
  private static readonly MAX_CODE_GENERATION_RETRIES = 5;

  private assertRetryLimit(depth: number, entityType: string): void {
    if (depth >= ConfiguracionCodigosService.MAX_CODE_GENERATION_RETRIES) {
      throw new Error(
        `Se excedió el máximo de reintentos (${ConfiguracionCodigosService.MAX_CODE_GENERATION_RETRIES}) generando código de ${entityType}`,
      );
    }
  }

  private async withSerializableTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        const isSerializationError =
          error?.code === 'P2034' ||
          error?.message?.includes('could not serialize');
        if (isSerializationError && attempt < maxRetries) {
          this.logger.warn(
            `Conflicto de serialización en generación de código, reintento ${attempt + 1}/${maxRetries}`,
          );
          continue;
        }
        throw error;
      }
    }
    throw new Error('Se excedió el máximo de reintentos de serialización');
  }

  // =====================================================
  // GESTIÓN DE CONFIGURACIÓN
  // =====================================================

  /**
   * Obtener o crear configuración de códigos para una empresa
   */
  async getConfiguracion(
    empresaId: string,
  ): Promise<ConfiguracionResponseDto> {
    // Intentar obtener desde caché
    const cacheKey = `config:codigos:${empresaId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ConfiguracionResponseDto;
    }

    // Obtener o crear configuración
    let config = await this.prisma.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await this.prisma.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Calcular próximos códigos
    const proximoProducto = this.formatCodigo(
      config.productoCodigo,
      config.productoSeparador,
      config.ultimoProducto + 1,
      config.productoLongitud,
    );

    const proximaVariante = this.formatCodigo(
      config.varianteCodigo,
      config.varianteSeparador,
      config.ultimaVariante + 1,
      config.varianteLongitud,
    );

    const proximoServicio = this.formatCodigo(
      config.servicioCodigo,
      config.servicioSeparador,
      config.ultimoServicio + 1,
      config.servicioLongitud,
    );

    const proximaVenta = this.formatCodigo(
      config.ventaCodigo,
      config.ventaSeparador,
      config.ultimaVenta + 1,
      config.ventaLongitud,
    );

    const proximoComponente = this.formatCodigo(
      config.componenteCodigo,
      config.componenteSeparador,
      config.ultimoComponente + 1,
      config.componenteLongitud,
    );

    const proximaOrdenServicio = this.formatCodigo(
      config.ordenServicioCodigo,
      config.ordenServicioSeparador,
      config.ultimaOrdenServicio + 1,
      config.ordenServicioLongitud,
    );

    const proximoProveedor = this.formatCodigo(
      config.proveedorCodigo,
      config.proveedorSeparador,
      config.ultimoProveedor + 1,
      config.proveedorLongitud,
    );

    const proximaTransferencia = this.formatCodigo(
      config.transferenciaCodigo,
      config.transferenciaSeparador,
      config.ultimaTransferencia + 1,
      config.transferenciaLongitud,
    );

    const proximaOrdenCompra = this.formatCodigo(
      config.ordenCompraCodigo,
      config.ordenCompraSeparador,
      config.ultimaOrdenCompra + 1,
      config.ordenCompraLongitud,
    );

    const proximaCompra = this.formatCodigo(
      config.compraCodigo,
      config.compraSeparador,
      config.ultimaCompra + 1,
      config.compraLongitud,
    );

    const proximoLote = this.formatCodigo(
      config.loteCodigo,
      config.loteSeparador,
      config.ultimoLote + 1,
      config.loteLongitud,
    );

    const proximaSede = this.formatCodigo(
      config.sedeCodigo,
      config.sedeSeparador,
      config.ultimaSede + 1,
      config.sedeLongitud,
    );

    const proximoReporteIncidencia = this.formatCodigo(
      config.reporteIncidenciaCodigo,
      config.reporteIncidenciaSeparador,
      config.ultimoReporteIncidencia + 1,
      config.reporteIncidenciaLongitud,
    );

    const proximoInventario = this.formatCodigo(
      config.inventarioCodigo,
      config.inventarioSeparador,
      config.ultimoInventario + 1,
      config.inventarioLongitud,
    );

    // Verificar restricciones (si existen entidades, no se puede cambiar prefijo)
    const [countProductos, countVariantes, countServicios] =
      await Promise.all([
        this.prisma.producto.count({
          where: { empresaId, deletedAt: null },
        }),
        this.prisma.productoVariante.count({
          where: { empresaId, deletedAt: null },
        }),
        this.prisma.servicio.count({
          where: { empresaId, deletedAt: null },
        }),
      ]);

    const response: ConfiguracionResponseDto = {
      id: config.id,
      empresaId: config.empresaId,
      productos: {
        codigo: config.productoCodigo,
        separador: config.productoSeparador,
        longitud: config.productoLongitud,
        incluirSede: config.productoIncluirSede,
        ultimoContador: config.ultimoProducto,
        proximoCodigo: proximoProducto,
      },
      variantes: {
        codigo: config.varianteCodigo,
        separador: config.varianteSeparador,
        longitud: config.varianteLongitud,
        ultimoContador: config.ultimaVariante,
        proximoCodigo: proximaVariante,
      },
      servicios: {
        codigo: config.servicioCodigo,
        separador: config.servicioSeparador,
        longitud: config.servicioLongitud,
        incluirSede: config.servicioIncluirSede,
        ultimoContador: config.ultimoServicio,
        proximoCodigo: proximoServicio,
      },
      ventas: {
        codigo: config.ventaCodigo,
        separador: config.ventaSeparador,
        longitud: config.ventaLongitud,
        incluirSede: config.ventaIncluirSede,
        ultimoContador: config.ultimaVenta,
        proximoCodigo: proximaVenta,
      },
      componentes: {
        codigo: config.componenteCodigo,
        separador: config.componenteSeparador,
        longitud: config.componenteLongitud,
        ultimoContador: config.ultimoComponente,
        proximoCodigo: proximoComponente,
      },
      ordenesServicio: {
        codigo: config.ordenServicioCodigo,
        separador: config.ordenServicioSeparador,
        longitud: config.ordenServicioLongitud,
        ultimoContador: config.ultimaOrdenServicio,
        proximoCodigo: proximaOrdenServicio,
      },
      proveedores: {
        codigo: config.proveedorCodigo,
        separador: config.proveedorSeparador,
        longitud: config.proveedorLongitud,
        ultimoContador: config.ultimoProveedor,
        proximoCodigo: proximoProveedor,
      },
      transferencias: {
        codigo: config.transferenciaCodigo,
        separador: config.transferenciaSeparador,
        longitud: config.transferenciaLongitud,
        ultimoContador: config.ultimaTransferencia,
        proximoCodigo: proximaTransferencia,
      },
      ordenesCompra: {
        codigo: config.ordenCompraCodigo,
        separador: config.ordenCompraSeparador,
        longitud: config.ordenCompraLongitud,
        ultimoContador: config.ultimaOrdenCompra,
        proximoCodigo: proximaOrdenCompra,
      },
      compras: {
        codigo: config.compraCodigo,
        separador: config.compraSeparador,
        longitud: config.compraLongitud,
        ultimoContador: config.ultimaCompra,
        proximoCodigo: proximaCompra,
      },
      lotes: {
        codigo: config.loteCodigo,
        separador: config.loteSeparador,
        longitud: config.loteLongitud,
        ultimoContador: config.ultimoLote,
        proximoCodigo: proximoLote,
      },
      sedes: {
        codigo: config.sedeCodigo,
        separador: config.sedeSeparador,
        longitud: config.sedeLongitud,
        ultimoContador: config.ultimaSede,
        proximoCodigo: proximaSede,
      },
      reportesIncidencia: {
        codigo: config.reporteIncidenciaCodigo,
        separador: config.reporteIncidenciaSeparador,
        longitud: config.reporteIncidenciaLongitud,
        ultimoContador: config.ultimoReporteIncidencia,
        proximoCodigo: proximoReporteIncidencia,
      },
      inventarios: {
        codigo: config.inventarioCodigo,
        separador: config.inventarioSeparador,
        longitud: config.inventarioLongitud,
        ultimoContador: config.ultimoInventario,
        proximoCodigo: proximoInventario,
      },
      documentos: {
        factura: {
          codigo: config.facturaCodigo,
          ultimoContador: config.ultimoFactura,
          proximoCodigo: this.formatCodigo(
            config.facturaCodigo,
            config.documentoSeparador,
            config.ultimoFactura + 1,
            config.documentoLongitud,
          ),
        },
        boleta: {
          codigo: config.boletaCodigo,
          ultimoContador: config.ultimaBoleta,
          proximoCodigo: this.formatCodigo(
            config.boletaCodigo,
            config.documentoSeparador,
            config.ultimaBoleta + 1,
            config.documentoLongitud,
          ),
        },
        notaCredito: {
          codigo: config.notaCreditoCodigo,
          ultimoContador: config.ultimaNotaCredito,
          proximoCodigo: this.formatCodigo(
            config.notaCreditoCodigo,
            config.documentoSeparador,
            config.ultimaNotaCredito + 1,
            config.documentoLongitud,
          ),
        },
        notaDebito: {
          codigo: config.notaDebitoCodigo,
          ultimoContador: config.ultimaNotaDebito,
          proximoCodigo: this.formatCodigo(
            config.notaDebitoCodigo,
            config.documentoSeparador,
            config.ultimaNotaDebito + 1,
            config.documentoLongitud,
          ),
        },
        separador: config.documentoSeparador,
        longitud: config.documentoLongitud,
      },
      restricciones: {
        puedeModificarProductoCodigo: countProductos === 0,
        puedeModificarVarianteCodigo: countVariantes === 0,
        puedeModificarServicioCodigo: countServicios === 0,
        razonProducto:
          countProductos > 0
            ? `Existen ${countProductos} productos. No se puede cambiar el prefijo.`
            : undefined,
        razonVariante:
          countVariantes > 0
            ? `Existen ${countVariantes} variantes. No se puede cambiar el prefijo.`
            : undefined,
        razonServicio:
          countServicios > 0
            ? `Existen ${countServicios} servicios. No se puede cambiar el prefijo.`
            : undefined,
      },
      creadoEn: config.creadoEn,
      actualizadoEn: config.actualizadoEn,
    };

    // Guardar en caché por 5 minutos (300 segundos)
    await this.redis.setex(cacheKey, 300, JSON.stringify(response));

    return response;
  }

  /**
   * Actualizar configuración de productos
   */
  async updateConfigProductos(
    empresaId: string,
    dto: UpdateConfigProductosDto,
  ): Promise<ConfiguracionResponseDto> {
    // Validar que no existan productos si se intenta cambiar el código
    if (dto.productoCodigo !== undefined) {
      const count = await this.prisma.producto.count({
        where: { empresaId, deletedAt: null },
      });

      if (count > 0) {
        throw new BadRequestException(
          `No se puede cambiar el prefijo de productos. Existen ${count} productos activos.`,
        );
      }
    }

    await this.prisma.configuracionCodigos.update({
      where: { empresaId },
      data: dto,
    });

    // Invalidar caché
    await this.redis.del(`config:codigos:${empresaId}`);

    return this.getConfiguracion(empresaId);
  }

  /**
   * Actualizar configuración de variantes
   */
  async updateConfigVariantes(
    empresaId: string,
    dto: UpdateConfigVariantesDto,
  ): Promise<ConfiguracionResponseDto> {
    if (dto.varianteCodigo !== undefined) {
      const count = await this.prisma.productoVariante.count({
        where: { empresaId, deletedAt: null },
      });

      if (count > 0) {
        throw new BadRequestException(
          `No se puede cambiar el prefijo de variantes. Existen ${count} variantes activas.`,
        );
      }
    }

    await this.prisma.configuracionCodigos.update({
      where: { empresaId },
      data: dto,
    });

    await this.redis.del(`config:codigos:${empresaId}`);

    return this.getConfiguracion(empresaId);
  }

  /**
   * Actualizar configuración de ventas (Notas de Venta)
   */
  async updateConfigVentas(
    empresaId: string,
    dto: UpdateConfigVentasDto,
  ): Promise<ConfiguracionResponseDto> {
    // TODO: Cuando se implemente el modelo Venta, validar que no existan ventas
    // si se intenta cambiar el código, similar a productos y variantes
    // if (dto.ventaCodigo !== undefined) {
    //   const count = await this.prisma.venta.count({
    //     where: { empresaId, deletedAt: null },
    //   });
    //   if (count > 0) {
    //     throw new BadRequestException(
    //       `No se puede cambiar el prefijo de ventas. Existen ${count} ventas activas.`,
    //     );
    //   }
    // }

    await this.prisma.configuracionCodigos.update({
      where: { empresaId },
      data: dto,
    });

    await this.redis.del(`config:codigos:${empresaId}`);

    return this.getConfiguracion(empresaId);
  }

  // =====================================================
  // GENERACIÓN DE CÓDIGOS (CENTRALIZADO) ⭐
  // =====================================================

  /**
   * GENERAR CÓDIGO DE PRODUCTO (incluye combos)
   * Usa transacción para evitar race conditions
   * @param empresaId ID de la empresa
   * @param sedeId ID de la sede (opcional)
   * @param tx Transacción de Prisma (opcional)
   */
  async generarCodigoProducto(
    empresaId: string,
    sedeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoEmpresa: string; codigoSistema: string }> {
    // Si ya hay una transacción, usarla directamente
    if (tx) {
      return await this._generarCodigoProductoInTransaction(
        tx,
        empresaId,
        sedeId,
      );
    }

    // Si no hay transacción, crear una nueva
    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoProductoInTransaction(
        txInner,
        empresaId,
        sedeId,
      );
    });
  }

  /**
   * Lógica interna de generación de código de producto
   */
  private async _generarCodigoProductoInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId?: string,
    depth = 0,
  ): Promise<{ codigoEmpresa: string; codigoSistema: string }> {
    this.assertRetryLimit(depth, 'producto');
    // Obtener o crear configuración
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Sincronizar contador con el estado real de la BD
    const ultimoProducto = await tx.producto.findFirst({
      where: {
        empresaId,
        deletedAt: null,
        codigoEmpresa: {
          startsWith: config.productoCodigo,
        },
      },
      orderBy: {
        codigoEmpresa: 'desc',
      },
      select: {
        codigoEmpresa: true,
      },
    });

    let nuevoContador = config.ultimoProducto;

    // Si hay productos, extraer el número del último código
    if (ultimoProducto) {
      const match = ultimoProducto.codigoEmpresa.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= nuevoContador) {
          nuevoContador = ultimoNumero;
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoProducto" = GREATEST("ultimoProducto", ${nuevoContador})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    // Incrementar contador atómicamente
    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimoProducto: {
          increment: 1,
        },
      },
    });

    nuevoContador = updated.ultimoProducto;

    // Generar código
    const numero = nuevoContador
      .toString()
      .padStart(config.productoLongitud, '0');
    let codigoEmpresa = `${config.productoCodigo}${config.productoSeparador}${numero}`;

    // Si incluye sede
    if (config.productoIncluirSede && sedeId) {
      const sede = await tx.sede.findUnique({
        where: { id: sedeId },
        select: { nombre: true },
      });
      if (sede) {
        const sedeCode = sede.nombre.substring(0, 3).toUpperCase();
        codigoEmpresa = `${config.productoCodigo}${config.productoSeparador}${sedeCode}${config.productoSeparador}${numero}`;
      }
    }

    const codigoSistema = `${empresaId.substring(0, 8)}-PROD-${numero}`;

    // Verificación final de duplicados
    const existe = await tx.producto.findFirst({
      where: {
        empresaId,
        codigoEmpresa,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existe) {
      this.logger.warn(
        `Código ${codigoEmpresa} ya existe. Reintentando recursivamente...`,
      );
      // Reintentar recursivamente
      return this._generarCodigoProductoInTransaction(tx, empresaId, sedeId, depth + 1);
    }

    return { codigoEmpresa, codigoSistema };
  }

  /**
   * GENERAR CÓDIGO DE VARIANTE
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   */
  async generarCodigoVariante(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoEmpresa: string }> {
    if (tx) {
      return await this._generarCodigoVarianteInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoVarianteInTransaction(txInner, empresaId);
    });
  }

  /**
   * Lógica interna de generación de código de variante
   */
  private async _generarCodigoVarianteInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<{ codigoEmpresa: string }> {
    this.assertRetryLimit(depth, 'variante');
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Sincronizar con BD
    const ultimaVariante = await tx.productoVariante.findFirst({
      where: {
        empresaId,
        deletedAt: null,
        codigoEmpresa: {
          startsWith: config.varianteCodigo,
        },
      },
      orderBy: {
        codigoEmpresa: 'desc',
      },
      select: {
        codigoEmpresa: true,
      },
    });

    let nuevoContador = config.ultimaVariante;

    if (ultimaVariante) {
      const match = ultimaVariante.codigoEmpresa.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= nuevoContador) {
          nuevoContador = ultimoNumero;
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaVariante" = GREATEST("ultimaVariante", ${nuevoContador})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    // Incrementar atómicamente
    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimaVariante: {
          increment: 1,
        },
      },
    });

    nuevoContador = updated.ultimaVariante;

    const numero = nuevoContador
      .toString()
      .padStart(config.varianteLongitud, '0');
    const codigoEmpresa = `${config.varianteCodigo}${config.varianteSeparador}${numero}`;

    // Verificación de duplicados
    const existe = await tx.productoVariante.findFirst({
      where: {
        empresaId,
        codigoEmpresa,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existe) {
      this.logger.warn(
        `Código de variante ${codigoEmpresa} ya existe. Reintentando...`,
      );
      return this._generarCodigoVarianteInTransaction(tx, empresaId, depth + 1);
    }

    return { codigoEmpresa };
  }

  /**
   * GENERAR CÓDIGO DE SEDE
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   * @returns Código de sede generado (ej: SEDE-002)
   */
  async generarCodigoSede(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoSede: string }> {
    if (tx) {
      return await this._generarCodigoSedeInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoSedeInTransaction(txInner, empresaId);
    });
  }

  /**
   * Lógica interna de generación de código de sede
   * Busca el número más alto usado (incluidas eliminadas) para evitar conflictos
   */
  private async _generarCodigoSedeInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<{ codigoSede: string }> {
    this.assertRetryLimit(depth, 'sede');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    // Sincronizar contador con BD real
    const ultimaSede = await tx.sede.findFirst({
      where: { empresaId, codigo: { startsWith: config.sedeCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimaSede) {
      const match = ultimaSede.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimaSede) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaSede" = GREATEST("ultimaSede", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimaSede: { increment: 1 } },
    });

    const numero = updated.ultimaSede.toString().padStart(config.sedeLongitud, '0');
    const codigoSede = `${config.sedeCodigo}${config.sedeSeparador}${numero}`;

    const existe = await tx.sede.findFirst({
      where: { empresaId, codigo: codigoSede },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de sede ${codigoSede} ya existe. Reintentando...`);
      return this._generarCodigoSedeInTransaction(tx, empresaId, depth + 1);
    }

    return { codigoSede };
  }

  /**
   * GENERAR CÓDIGO DE VENTA (Nota de Venta)
   * @param empresaId ID de la empresa
   * @param sedeId ID de la sede (opcional, se incluye si ventaIncluirSede = true)
   * @param tx Transacción de Prisma (opcional)
   * @returns Código de venta generado (ej: VTA-00000001 o VTA-SEDE001-00000001)
   */
  async generarCodigoVenta(
    empresaId: string,
    sedeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoVenta: string }> {
    if (tx) {
      return await this._generarCodigoVentaInTransaction(tx, empresaId, sedeId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoVentaInTransaction(
        txInner,
        empresaId,
        sedeId,
      );
    });
  }

  /**
   * Lógica interna de generación de código de venta
   * NOTA: No verifica duplicados ya que el modelo Venta aún no está implementado
   */
  private async _generarCodigoVentaInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId?: string,
  ): Promise<{ codigoVenta: string }> {
    // Obtener o crear configuración
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // TODO: Cuando se implemente el modelo Venta, sincronizar contador con BD
    // como se hace en generarCodigoProducto y generarCodigoVariante

    // Incrementar contador atómicamente
    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimaVenta: {
          increment: 1,
        },
      },
    });

    const nuevoContador = updated.ultimaVenta;

    // Generar código
    const numero = nuevoContador.toString().padStart(config.ventaLongitud, '0');
    let codigoVenta = `${config.ventaCodigo}${config.ventaSeparador}${numero}`;

    // Si incluye sede
    if (config.ventaIncluirSede && sedeId) {
      const sede = await tx.sede.findUnique({
        where: { id: sedeId },
        select: { nombre: true },
      });
      if (sede) {
        const sedeCode = sede.nombre.substring(0, 3).toUpperCase();
        codigoVenta = `${config.ventaCodigo}${config.ventaSeparador}${sedeCode}${config.ventaSeparador}${numero}`;
      }
    }

    // TODO: Cuando se implemente el modelo Venta, agregar verificación de duplicados
    // como se hace en generarCodigoProducto y generarCodigoVariante

    return { codigoVenta };
  }

  /**
   * GENERAR CÓDIGO DE TRANSFERENCIA DE STOCK
   * Formato: TRANS-2026-00001 (basado en año actual)
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   */
  async generarCodigoTransferencia(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoTransferenciaInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoTransferenciaInTransaction(
        txInner,
        empresaId,
      );
    });
  }

  /**
   * Lógica interna de generación de código de transferencia
   * Busca el número más alto del año actual para evitar duplicados
   */
  private async _generarCodigoTransferenciaInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'transferencia');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    // Sincronizar contador con BD real
    const ultimaTransferencia = await tx.transferenciaStock.findFirst({
      where: { empresaId, codigo: { startsWith: config.transferenciaCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimaTransferencia) {
      const match = ultimaTransferencia.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimaTransferencia) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaTransferencia" = GREATEST("ultimaTransferencia", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimaTransferencia: { increment: 1 } },
    });

    const numero = updated.ultimaTransferencia.toString().padStart(config.transferenciaLongitud, '0');
    const codigo = `${config.transferenciaCodigo}${config.transferenciaSeparador}${numero}`;

    const existe = await tx.transferenciaStock.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de transferencia ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoTransferenciaInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  // =====================================================
  // GENERACIÓN DE CÓDIGOS DE COMPRAS
  // =====================================================

  /**
   * GENERAR CÓDIGO DE ORDEN DE COMPRA
   * Formato: OC-2026-00001 (basado en año actual)
   */
  async generarCodigoOrdenCompra(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoOrdenCompraInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoOrdenCompraInTransaction(
        txInner,
        empresaId,
      );
    });
  }

  private async _generarCodigoOrdenCompraInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'ordenCompra');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimaOC = await tx.ordenCompra.findFirst({
      where: { empresaId, codigo: { startsWith: config.ordenCompraCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimaOC) {
      const match = ultimaOC.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimaOrdenCompra) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaOrdenCompra" = GREATEST("ultimaOrdenCompra", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimaOrdenCompra: { increment: 1 } },
    });

    const numero = updated.ultimaOrdenCompra.toString().padStart(config.ordenCompraLongitud, '0');
    const codigo = `${config.ordenCompraCodigo}${config.ordenCompraSeparador}${numero}`;

    const existe = await tx.ordenCompra.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de OC ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoOrdenCompraInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  /**
   * GENERAR CÓDIGO DE COMPRA (RECEPCIÓN)
   * Formato: COMP-2026-00001 (basado en año actual)
   */
  async generarCodigoCompra(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoCompraInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoCompraInTransaction(txInner, empresaId);
    });
  }

  private async _generarCodigoCompraInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'compra');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimaCompra = await tx.compra.findFirst({
      where: { empresaId, codigo: { startsWith: config.compraCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimaCompra) {
      const match = ultimaCompra.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimaCompra) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaCompra" = GREATEST("ultimaCompra", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimaCompra: { increment: 1 } },
    });

    const numero = updated.ultimaCompra.toString().padStart(config.compraLongitud, '0');
    const codigo = `${config.compraCodigo}${config.compraSeparador}${numero}`;

    const existe = await tx.compra.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de compra ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoCompraInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  /**
   * GENERAR CÓDIGO DE LOTE
   * Formato: LOTE-2026-00001 (basado en año actual)
   */
  async generarCodigoLote(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoLoteInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoLoteInTransaction(txInner, empresaId);
    });
  }

  private async _generarCodigoLoteInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'lote');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimoLote = await tx.lote.findFirst({
      where: { empresaId, codigo: { startsWith: config.loteCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimoLote) {
      const match = ultimoLote.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimoLote) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoLote" = GREATEST("ultimoLote", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimoLote: { increment: 1 } },
    });

    const numero = updated.ultimoLote.toString().padStart(config.loteLongitud, '0');
    const codigo = `${config.loteCodigo}${config.loteSeparador}${numero}`;

    const existe = await tx.lote.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de lote ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoLoteInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  // =====================================================
  // VISTA PREVIA Y UTILIDADES
  // =====================================================

  /**
   * Vista previa de cómo se verá un código
   */
  async previewCodigo(
    empresaId: string,
    dto: PreviewCodigoDto,
  ): Promise<PreviewCodigoResponseDto> {
    const config = await this.prisma.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      throw new NotFoundException('Configuración no encontrada');
    }

    const numero = dto.numero || 1;
    let prefijo: string;
    let separador: string;
    let longitud: number;
    let codigo: string;
    let sedeCode: string | null = null;

    switch (dto.tipo) {
      case TipoCodigo.PRODUCTO:
        prefijo = config.productoCodigo;
        separador = config.productoSeparador;
        longitud = config.productoLongitud;

        if (config.productoIncluirSede && dto.sedeId) {
          const sede = await this.prisma.sede.findUnique({
            where: { id: dto.sedeId },
            select: { nombre: true },
          });
          if (sede) {
            sedeCode = sede.nombre.substring(0, 3).toUpperCase();
            codigo = `${prefijo}${separador}${sedeCode}${separador}${numero.toString().padStart(longitud, '0')}`;
          } else {
            codigo = this.formatCodigo(prefijo, separador, numero, longitud);
          }
        } else {
          codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        }
        break;

      case TipoCodigo.VARIANTE:
        prefijo = config.varianteCodigo;
        separador = config.varianteSeparador;
        longitud = config.varianteLongitud;
        codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        break;

      case TipoCodigo.SERVICIO:
        prefijo = config.servicioCodigo;
        separador = config.servicioSeparador;
        longitud = config.servicioLongitud;
        codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        break;

      case TipoCodigo.FACTURA:
        prefijo = config.facturaCodigo;
        separador = config.documentoSeparador;
        longitud = config.documentoLongitud;
        codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        break;

      case TipoCodigo.BOLETA:
        prefijo = config.boletaCodigo;
        separador = config.documentoSeparador;
        longitud = config.documentoLongitud;
        codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        break;

      case TipoCodigo.NOTA_CREDITO:
        prefijo = config.notaCreditoCodigo;
        separador = config.documentoSeparador;
        longitud = config.documentoLongitud;
        codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        break;

      case TipoCodigo.NOTA_DEBITO:
        prefijo = config.notaDebitoCodigo;
        separador = config.documentoSeparador;
        longitud = config.documentoLongitud;
        codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        break;

      case TipoCodigo.VENTA:
        prefijo = config.ventaCodigo;
        separador = config.ventaSeparador;
        longitud = config.ventaLongitud;

        if (config.ventaIncluirSede && dto.sedeId) {
          const sede = await this.prisma.sede.findUnique({
            where: { id: dto.sedeId },
            select: { nombre: true },
          });
          if (sede) {
            sedeCode = sede.nombre.substring(0, 3).toUpperCase();
            codigo = `${prefijo}${separador}${sedeCode}${separador}${numero.toString().padStart(longitud, '0')}`;
          } else {
            codigo = this.formatCodigo(prefijo, separador, numero, longitud);
          }
        } else {
          codigo = this.formatCodigo(prefijo, separador, numero, longitud);
        }
        break;

      default:
        throw new BadRequestException('Tipo de código no válido');
    }

    return {
      codigo,
      formato: {
        prefijo,
        separador,
        numero: numero.toString().padStart(longitud, '0'),
        sede: sedeCode,
      },
    };
  }

  /**
   * Sincronizar contador con el estado real de la BD
   */
  async sincronizarContador(
    empresaId: string,
    tipo: 'PRODUCTO' | 'VARIANTE' | 'SERVICIO',
  ): Promise<{ sincronizado: boolean; nuevoContador: number }> {
    const config = await this.prisma.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      throw new NotFoundException('Configuración no encontrada');
    }

    let ultimoNumero = 0;

    switch (tipo) {
      case 'PRODUCTO':
        const ultimoProducto = await this.prisma.producto.findFirst({
          where: {
            empresaId,
            deletedAt: null,
            codigoEmpresa: { startsWith: config.productoCodigo },
          },
          orderBy: { codigoEmpresa: 'desc' },
          select: { codigoEmpresa: true },
        });

        if (ultimoProducto) {
          const match = ultimoProducto.codigoEmpresa.match(/(\d+)$/);
          if (match) {
            ultimoNumero = parseInt(match[1], 10);
          }
        }

        await this.prisma.configuracionCodigos.update({
          where: { empresaId },
          data: { ultimoProducto: ultimoNumero },
        });
        break;

      case 'VARIANTE':
        const ultimaVariante = await this.prisma.productoVariante.findFirst({
          where: {
            empresaId,
            deletedAt: null,
            codigoEmpresa: { startsWith: config.varianteCodigo },
          },
          orderBy: { codigoEmpresa: 'desc' },
          select: { codigoEmpresa: true },
        });

        if (ultimaVariante) {
          const match = ultimaVariante.codigoEmpresa.match(/(\d+)$/);
          if (match) {
            ultimoNumero = parseInt(match[1], 10);
          }
        }

        await this.prisma.configuracionCodigos.update({
          where: { empresaId },
          data: { ultimaVariante: ultimoNumero },
        });
        break;

      case 'SERVICIO':
        const ultimoServicio = await this.prisma.servicio.findFirst({
          where: {
            empresaId,
            deletedAt: null,
            codigoEmpresa: { startsWith: config.servicioCodigo },
          },
          orderBy: { codigoEmpresa: 'desc' },
          select: { codigoEmpresa: true },
        });

        if (ultimoServicio) {
          const match = ultimoServicio.codigoEmpresa.match(/(\d+)$/);
          if (match) {
            ultimoNumero = parseInt(match[1], 10);
          }
        }

        await this.prisma.configuracionCodigos.update({
          where: { empresaId },
          data: { ultimoServicio: ultimoNumero },
        });
        break;
    }

    await this.redis.del(`config:codigos:${empresaId}`);

    return { sincronizado: true, nuevoContador: ultimoNumero };
  }

  /**
   * GENERAR CÓDIGO DE COTIZACIÓN
   * @param empresaId ID de la empresa
   * @param sedeId ID de la sede (opcional, se incluye si cotizacionIncluirSede = true)
   * @param tx Transacción de Prisma (opcional)
   * @returns Código de cotización generado (ej: COT-000001 o COT-SEDE-000001)
   */
  async generarCodigoCotizacion(
    empresaId: string,
    sedeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoCotizacion: string }> {
    if (tx) {
      return await this._generarCodigoCotizacionInTransaction(tx, empresaId, sedeId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoCotizacionInTransaction(
        txInner,
        empresaId,
        sedeId,
      );
    });
  }

  /**
   * Lógica interna de generación de código de cotización
   */
  private async _generarCodigoCotizacionInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId?: string,
    depth = 0,
  ): Promise<{ codigoCotizacion: string }> {
    this.assertRetryLimit(depth, 'cotizacion');
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Sincronizar con BD
    const ultimaCotizacion = await tx.cotizacion.findFirst({
      where: {
        empresaId,
        codigo: {
          startsWith: config.cotizacionCodigo,
        },
      },
      orderBy: {
        codigo: 'desc',
      },
      select: {
        codigo: true,
      },
    });

    let nuevoContador = config.ultimaCotizacion;

    if (ultimaCotizacion) {
      const match = ultimaCotizacion.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= nuevoContador) {
          nuevoContador = ultimoNumero;
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaCotizacion" = GREATEST("ultimaCotizacion", ${nuevoContador})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    // Incrementar contador atómicamente
    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimaCotizacion: {
          increment: 1,
        },
      },
    });

    nuevoContador = updated.ultimaCotizacion;

    // Generar código
    const numero = nuevoContador
      .toString()
      .padStart(config.cotizacionLongitud, '0');
    let codigoCotizacion = `${config.cotizacionCodigo}${config.cotizacionSeparador}${numero}`;

    // Si incluye sede
    if (config.cotizacionIncluirSede && sedeId) {
      const sede = await tx.sede.findUnique({
        where: { id: sedeId },
        select: { nombre: true },
      });
      if (sede) {
        const sedeCode = sede.nombre.substring(0, 3).toUpperCase();
        codigoCotizacion = `${config.cotizacionCodigo}${config.cotizacionSeparador}${sedeCode}${config.cotizacionSeparador}${numero}`;
      }
    }

    // Verificación final de duplicados
    const existe = await tx.cotizacion.findFirst({
      where: {
        empresaId,
        codigo: codigoCotizacion,
      },
      select: { id: true },
    });

    if (existe) {
      this.logger.warn(
        `Código de cotización ${codigoCotizacion} ya existe. Reintentando...`,
      );
      return this._generarCodigoCotizacionInTransaction(tx, empresaId, sedeId, depth + 1);
    }

    return { codigoCotizacion };
  }

  // =====================================================
  // GENERACIÓN DE CÓDIGOS DE SERVICIOS
  // =====================================================

  /**
   * GENERAR CÓDIGO DE SERVICIO
   * Usa transacción para evitar race conditions
   * @param empresaId ID de la empresa
   * @param sedeId ID de la sede (opcional)
   * @param tx Transacción de Prisma (opcional)
   */
  async generarCodigoServicio(
    empresaId: string,
    sedeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoEmpresa: string; codigoSistema: string }> {
    if (tx) {
      return await this._generarCodigoServicioInTransaction(
        tx,
        empresaId,
        sedeId,
      );
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoServicioInTransaction(
        txInner,
        empresaId,
        sedeId,
      );
    });
  }

  private async _generarCodigoServicioInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId?: string,
    depth = 0,
  ): Promise<{ codigoEmpresa: string; codigoSistema: string }> {
    this.assertRetryLimit(depth, 'servicio');
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Sincronizar contador con el estado real de la BD
    const ultimoServicio = await tx.servicio.findFirst({
      where: {
        empresaId,
        deletedAt: null,
        codigoEmpresa: {
          startsWith: config.servicioCodigo,
        },
      },
      orderBy: {
        codigoEmpresa: 'desc',
      },
      select: {
        codigoEmpresa: true,
      },
    });

    let nuevoContador = config.ultimoServicio;

    if (ultimoServicio) {
      const match = ultimoServicio.codigoEmpresa.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= nuevoContador) {
          nuevoContador = ultimoNumero;
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoServicio" = GREATEST("ultimoServicio", ${nuevoContador})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    // Incrementar contador atómicamente
    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimoServicio: {
          increment: 1,
        },
      },
    });

    nuevoContador = updated.ultimoServicio;

    // Generar código
    const numero = nuevoContador
      .toString()
      .padStart(config.servicioLongitud, '0');
    let codigoEmpresa = `${config.servicioCodigo}${config.servicioSeparador}${numero}`;

    // Si incluye sede
    if (config.servicioIncluirSede && sedeId) {
      const sede = await tx.sede.findUnique({
        where: { id: sedeId },
        select: { nombre: true },
      });
      if (sede) {
        const sedeCode = sede.nombre.substring(0, 3).toUpperCase();
        codigoEmpresa = `${config.servicioCodigo}${config.servicioSeparador}${sedeCode}${config.servicioSeparador}${numero}`;
      }
    }

    const codigoSistema = `${empresaId.substring(0, 8)}-SRV-${numero}`;

    // Verificación final de duplicados
    const existe = await tx.servicio.findFirst({
      where: {
        empresaId,
        codigoEmpresa,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existe) {
      this.logger.warn(
        `Código de servicio ${codigoEmpresa} ya existe. Reintentando...`,
      );
      return this._generarCodigoServicioInTransaction(tx, empresaId, sedeId, depth + 1);
    }

    return { codigoEmpresa, codigoSistema };
  }

  /**
   * GENERAR CÓDIGO DE ORDEN DE SERVICIO
   * Formato: OS-YYYY-NNNNN (basado en año actual)
   * @param empresaId ID de la empresa
   * @param sedeId ID de la sede (opcional)
   * @param tx Transacción de Prisma (opcional)
   */
  async generarCodigoOrdenServicio(
    empresaId: string,
    sedeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoOrdenServicioInTransaction(
        tx,
        empresaId,
      );
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoOrdenServicioInTransaction(
        txInner,
        empresaId,
      );
    });
  }

  private async _generarCodigoOrdenServicioInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'ordenServicio');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimaOrden = await tx.ordenServicio.findFirst({
      where: { empresaId, codigo: { startsWith: config.ordenServicioCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimaOrden) {
      const match = ultimaOrden.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimaOrdenServicio) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimaOrdenServicio" = GREATEST("ultimaOrdenServicio", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimaOrdenServicio: { increment: 1 } },
    });

    const numero = updated.ultimaOrdenServicio.toString().padStart(config.ordenServicioLongitud, '0');
    const codigo = `${config.ordenServicioCodigo}${config.ordenServicioSeparador}${numero}`;

    const existe = await tx.ordenServicio.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de orden ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoOrdenServicioInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  /**
   * GENERAR CÓDIGO DE COMPONENTE
   * Formato configurable: COMP-00001 (por defecto)
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   * @returns Código de componente generado
   */
  async generarCodigoComponente(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoComponenteInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoComponenteInTransaction(
        txInner,
        empresaId,
      );
    });
  }

  private async _generarCodigoComponenteInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'componente');
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    // Sincronizar contador con el estado real de la BD
    const ultimoComp = await tx.componente.findFirst({
      where: {
        empresaId,
        deletedAt: null,
        codigo: {
          startsWith: config.componenteCodigo,
        },
      },
      orderBy: {
        codigo: 'desc',
      },
      select: {
        codigo: true,
      },
    });

    let nuevoContador = config.ultimoComponente;

    if (ultimoComp) {
      const match = ultimoComp.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= nuevoContador) {
          nuevoContador = ultimoNumero;
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoComponente" = GREATEST("ultimoComponente", ${nuevoContador})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    // Incrementar contador atómicamente
    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimoComponente: {
          increment: 1,
        },
      },
    });

    nuevoContador = updated.ultimoComponente;

    // Generar código
    const numero = nuevoContador
      .toString()
      .padStart(config.componenteLongitud, '0');
    const codigo = `${config.componenteCodigo}${config.componenteSeparador}${numero}`;

    // Verificación final de duplicados
    const existe = await tx.componente.findFirst({
      where: {
        empresaId,
        codigo,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existe) {
      this.logger.warn(
        `Código de componente ${codigo} ya existe. Reintentando...`,
      );
      return this._generarCodigoComponenteInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  // =====================================================
  // GENERACIÓN DE CÓDIGO DE INVENTARIO
  // =====================================================

  /**
   * GENERAR CÓDIGO DE INVENTARIO
   * Formato configurable: INV-0001 (por defecto)
   */
  async generarCodigoInventario(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoInventarioInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoInventarioInTransaction(txInner, empresaId);
    });
  }

  private async _generarCodigoInventarioInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'inventario');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimoInv = await tx.inventario.findFirst({
      where: { empresaId, codigo: { startsWith: config.inventarioCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimoInv) {
      const match = ultimoInv.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimoInventario) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoInventario" = GREATEST("ultimoInventario", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimoInventario: { increment: 1 } },
    });

    const numero = updated.ultimoInventario.toString().padStart(config.inventarioLongitud, '0');
    const codigo = `${config.inventarioCodigo}${config.inventarioSeparador}${numero}`;

    const existe = await tx.inventario.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de inventario ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoInventarioInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  // =====================================================
  // HELPERS PRIVADOS
  // =====================================================

  /**
   * GENERAR CÓDIGO DE PROVEEDOR
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   * @returns Código de proveedor generado (ej: PROV-001)
   */
  async generarCodigoProveedor(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoProveedor: string }> {
    if (tx) {
      return await this._generarCodigoProveedorInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoProveedorInTransaction(txInner, empresaId);
    });
  }

  private async _generarCodigoProveedorInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<{ codigoProveedor: string }> {
    this.assertRetryLimit(depth, 'proveedor');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimoProv = await tx.proveedor.findFirst({
      where: { empresaId, codigo: { startsWith: config.proveedorCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimoProv) {
      const match = ultimoProv.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimoProveedor) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoProveedor" = GREATEST("ultimoProveedor", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimoProveedor: { increment: 1 } },
    });

    const numero = updated.ultimoProveedor.toString().padStart(config.proveedorLongitud, '0');
    const codigoProveedor = `${config.proveedorCodigo}${config.proveedorSeparador}${numero}`;

    const existe = await tx.proveedor.findFirst({
      where: { empresaId, codigo: codigoProveedor },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de proveedor ${codigoProveedor} ya existe. Reintentando...`);
      return this._generarCodigoProveedorInTransaction(tx, empresaId, depth + 1);
    }

    return { codigoProveedor };
  }

  /**
   * GENERAR CÓDIGO DE REPORTE DE INCIDENCIA
   * Formato: RPI-YYYY-NNNN (Reporte de Productos Incidencia - Año - Número secuencial)
   * @param empresaId ID de la empresa
   * @param tx Transacción de Prisma (opcional)
   */
  async generarCodigoReporteIncidencia(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return await this._generarCodigoReporteIncidenciaInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoReporteIncidenciaInTransaction(
        txInner,
        empresaId,
      );
    });
  }

  private async _generarCodigoReporteIncidenciaInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<string> {
    this.assertRetryLimit(depth, 'reporteIncidencia');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimoReporte = await tx.reporteIncidencia.findFirst({
      where: { empresaId, codigo: { startsWith: config.reporteIncidenciaCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimoReporte) {
      const match = ultimoReporte.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimoReporteIncidencia) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoReporteIncidencia" = GREATEST("ultimoReporteIncidencia", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimoReporteIncidencia: { increment: 1 } },
    });

    const numero = updated.ultimoReporteIncidencia.toString().padStart(config.reporteIncidenciaLongitud, '0');
    const codigo = `${config.reporteIncidenciaCodigo}${config.reporteIncidenciaSeparador}${numero}`;

    const existe = await tx.reporteIncidencia.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de reporte ${codigo} ya existe. Reintentando...`);
      return this._generarCodigoReporteIncidenciaInTransaction(tx, empresaId, depth + 1);
    }

    return codigo;
  }

  // ─── GENERAR CÓDIGO DE CLIENTE EMPRESA ───

  async generarCodigoClienteEmpresa(
    empresaId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ codigoClienteEmpresa: string }> {
    if (tx) {
      return await this._generarCodigoClienteEmpresaInTransaction(tx, empresaId);
    }

    return await this.withSerializableTransaction(async (txInner) => {
      return await this._generarCodigoClienteEmpresaInTransaction(txInner, empresaId);
    });
  }

  private async _generarCodigoClienteEmpresaInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
    depth = 0,
  ): Promise<{ codigoClienteEmpresa: string }> {
    this.assertRetryLimit(depth, 'clienteEmpresa');
    let config = await tx.configuracionCodigos.findUnique({ where: { empresaId } });
    if (!config) config = await tx.configuracionCodigos.create({ data: { empresaId } });

    const ultimoCE = await tx.clienteEmpresa.findFirst({
      where: { empresaId, codigo: { startsWith: config.clienteEmpresaCodigo } },
      orderBy: { codigo: 'desc' },
      select: { codigo: true },
    });
    if (ultimoCE) {
      const match = ultimoCE.codigo.match(/(\d+)$/);
      if (match) {
        const ultimoNumero = parseInt(match[1], 10);
        if (ultimoNumero >= config.ultimoClienteEmpresa) {
          await tx.$executeRaw`
            UPDATE "ConfiguracionCodigos"
            SET "ultimoClienteEmpresa" = GREATEST("ultimoClienteEmpresa", ${ultimoNumero})
            WHERE "empresaId" = ${empresaId}
          `;
        }
      }
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimoClienteEmpresa: { increment: 1 } },
    });

    const numero = updated.ultimoClienteEmpresa.toString().padStart(config.clienteEmpresaLongitud, '0');
    const codigoClienteEmpresa = `${config.clienteEmpresaCodigo}${config.clienteEmpresaSeparador}${numero}`;

    const existe = await tx.clienteEmpresa.findFirst({
      where: { empresaId, codigo: codigoClienteEmpresa },
      select: { id: true },
    });
    if (existe) {
      this.logger.warn(`Código de cliente empresa ${codigoClienteEmpresa} ya existe. Reintentando...`);
      return this._generarCodigoClienteEmpresaInTransaction(tx, empresaId, depth + 1);
    }

    return { codigoClienteEmpresa };
  }

  /**
   * Formatear código con prefijo, separador y número
   */
  private formatCodigo(
    prefijo: string,
    separador: string,
    numero: number,
    longitud: number,
  ): string {
    const numeroFormateado = numero.toString().padStart(longitud, '0');
    return `${prefijo}${separador}${numeroFormateado}`;
  }
}
