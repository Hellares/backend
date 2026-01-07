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
    return await this.prisma.$transaction(async (txInner) => {
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
  ): Promise<{ codigoEmpresa: string; codigoSistema: string }> {
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
          await tx.configuracionCodigos.update({
            where: { empresaId },
            data: { ultimoProducto: nuevoContador },
          });
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
      return this._generarCodigoProductoInTransaction(tx, empresaId, sedeId);
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

    return await this.prisma.$transaction(async (txInner) => {
      return await this._generarCodigoVarianteInTransaction(txInner, empresaId);
    });
  }

  /**
   * Lógica interna de generación de código de variante
   */
  private async _generarCodigoVarianteInTransaction(
    tx: Prisma.TransactionClient,
    empresaId: string,
  ): Promise<{ codigoEmpresa: string }> {
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
          await tx.configuracionCodigos.update({
            where: { empresaId },
            data: { ultimaVariante: nuevoContador },
          });
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
      return this._generarCodigoVarianteInTransaction(tx, empresaId);
    }

    return { codigoEmpresa };
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

  // =====================================================
  // HELPERS PRIVADOS
  // =====================================================

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
