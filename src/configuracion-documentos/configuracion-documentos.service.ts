import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoDocumento, FormatoPapel } from '@prisma/client';
import { AppLoggerService } from '../common/logger/logger.service';
import { UpdateConfiguracionDocumentosDto } from './dto/update-configuracion-documentos.dto';
import { UpdatePlantillaDocumentoDto } from './dto/update-plantilla-documento.dto';

const DEFAULT_PLANTILLAS: {
  tipo: TipoDocumento;
  nombre: string;
}[] = [
  { tipo: TipoDocumento.COTIZACION, nombre: 'Plantilla Cotizacion' },
  { tipo: TipoDocumento.FACTURA, nombre: 'Plantilla Factura' },
  { tipo: TipoDocumento.BOLETA, nombre: 'Plantilla Boleta' },
];

@Injectable()
export class ConfiguracionDocumentosService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ConfiguracionDocumentosService.name);
  }

  /**
   * Obtener o crear configuracion de documentos para la empresa
   */
  async getOrCreateConfiguracion(empresaId: string) {
    let config = await this.prisma.configuracionDocumentos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      this.logger.info('Creating default document configuration', { empresaId });
      config = await this.prisma.configuracionDocumentos.create({
        data: { empresaId },
      });
    }

    return config;
  }

  /**
   * Actualizar configuracion global de documentos
   */
  async updateConfiguracion(
    empresaId: string,
    dto: UpdateConfiguracionDocumentosDto,
  ) {
    const config = await this.getOrCreateConfiguracion(empresaId);

    const updated = await this.prisma.configuracionDocumentos.update({
      where: { id: config.id },
      data: {
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.nombreComercial !== undefined && {
          nombreComercial: dto.nombreComercial,
        }),
        ...(dto.colorPrimario !== undefined && {
          colorPrimario: dto.colorPrimario,
        }),
        ...(dto.colorSecundario !== undefined && {
          colorSecundario: dto.colorSecundario,
        }),
        ...(dto.colorTexto !== undefined && { colorTexto: dto.colorTexto }),
        ...(dto.textoPiePagina !== undefined && {
          textoPiePagina: dto.textoPiePagina,
        }),
        ...(dto.textoPieVenta !== undefined && {
          textoPieVenta: dto.textoPieVenta,
        }),
        ...(dto.textoPieServicio !== undefined && {
          textoPieServicio: dto.textoPieServicio,
        }),
        ...(dto.mostrarPaginacion !== undefined && {
          mostrarPaginacion: dto.mostrarPaginacion,
        }),
      },
    });

    this.logger.info('Document configuration updated', { empresaId });
    return updated;
  }

  /**
   * Listar todas las plantillas de la empresa
   */
  async getPlantillas(empresaId: string) {
    return this.prisma.plantillaDocumento.findMany({
      where: { empresaId, isActive: true },
      orderBy: { tipoDocumento: 'asc' },
    });
  }

  /**
   * Obtener plantilla por tipo (o crearla con defaults si no existe)
   */
  async getPlantillaByTipo(
    empresaId: string,
    tipo: TipoDocumento,
    formato: FormatoPapel = FormatoPapel.A4,
  ) {
    let plantilla = await this.prisma.plantillaDocumento.findUnique({
      where: {
        empresaId_tipoDocumento_formatoPapel: {
          empresaId,
          tipoDocumento: tipo,
          formatoPapel: formato,
        },
      },
    });

    if (!plantilla) {
      const config = await this.getOrCreateConfiguracion(empresaId);
      plantilla = await this.prisma.plantillaDocumento.create({
        data: {
          empresaId,
          configuracionDocId: config.id,
          tipoDocumento: tipo,
          formatoPapel: formato,
          nombre: `Plantilla ${tipo}`,
        },
      });
      this.logger.info('Created default template', { empresaId, tipo, formato });
    }

    return plantilla;
  }

  /**
   * Actualizar plantilla por tipo y formato
   */
  async updatePlantilla(
    empresaId: string,
    tipo: TipoDocumento,
    dto: UpdatePlantillaDocumentoDto,
  ) {
    const formato =
      (dto.formatoPapel as unknown as FormatoPapel) ?? FormatoPapel.A4;
    const plantilla = await this.getPlantillaByTipo(empresaId, tipo, formato);

    const updated = await this.prisma.plantillaDocumento.update({
      where: { id: plantilla.id },
      data: {
        ...(dto.formatoPapel !== undefined && {
          formatoPapel: dto.formatoPapel as unknown as FormatoPapel,
        }),
        ...(dto.margenSuperior !== undefined && {
          margenSuperior: dto.margenSuperior,
        }),
        ...(dto.margenInferior !== undefined && {
          margenInferior: dto.margenInferior,
        }),
        ...(dto.margenIzquierdo !== undefined && {
          margenIzquierdo: dto.margenIzquierdo,
        }),
        ...(dto.margenDerecho !== undefined && {
          margenDerecho: dto.margenDerecho,
        }),
        ...(dto.mostrarLogo !== undefined && { mostrarLogo: dto.mostrarLogo }),
        ...(dto.mostrarDatosEmpresa !== undefined && {
          mostrarDatosEmpresa: dto.mostrarDatosEmpresa,
        }),
        ...(dto.mostrarDatosCliente !== undefined && {
          mostrarDatosCliente: dto.mostrarDatosCliente,
        }),
        ...(dto.mostrarDetalles !== undefined && {
          mostrarDetalles: dto.mostrarDetalles,
        }),
        ...(dto.mostrarTotales !== undefined && {
          mostrarTotales: dto.mostrarTotales,
        }),
        ...(dto.mostrarObservaciones !== undefined && {
          mostrarObservaciones: dto.mostrarObservaciones,
        }),
        ...(dto.mostrarCondiciones !== undefined && {
          mostrarCondiciones: dto.mostrarCondiciones,
        }),
        ...(dto.mostrarFirma !== undefined && {
          mostrarFirma: dto.mostrarFirma,
        }),
        ...(dto.mostrarCodigoQR !== undefined && {
          mostrarCodigoQR: dto.mostrarCodigoQR,
        }),
        ...(dto.mostrarPiePagina !== undefined && {
          mostrarPiePagina: dto.mostrarPiePagina,
        }),
        ...(dto.colorEncabezado !== undefined && {
          colorEncabezado: dto.colorEncabezado,
        }),
        ...(dto.colorCuerpo !== undefined && {
          colorCuerpo: dto.colorCuerpo,
        }),
        ...(dto.condicionesPorDefecto !== undefined && {
          condicionesPorDefecto: dto.condicionesPorDefecto,
        }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.posicionLogo !== undefined && {
          posicionLogo: dto.posicionLogo,
        }),
      },
    });

    this.logger.info('Template updated', { empresaId, tipo });
    return updated;
  }

  /**
   * Obtener configuracion completa: config global + plantilla por tipo + sede opcional
   * Este es el endpoint clave que Flutter llama antes de generar un PDF
   */
  async getConfiguracionCompleta(
    empresaId: string,
    tipo: TipoDocumento,
    formato: FormatoPapel = FormatoPapel.A4,
    sedeId?: string,
  ) {
    const [configuracion, plantilla, empresa] = await Promise.all([
      this.getOrCreateConfiguracion(empresaId),
      this.getPlantillaByTipo(empresaId, tipo, formato),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          ruc: true, razonSocial: true, nombre: true,
          direccionFiscal: true, telefono: true, email: true, logo: true,
        },
      }),
    ]);

    let sede = null;
    if (sedeId) {
      sede = await this.prisma.sede.findUnique({
        where: { id: sedeId },
        select: {
          id: true, nombre: true,
          direccion: true, telefono: true, email: true,
          distrito: true, provincia: true, departamento: true,
          rucSede: true, razonSocialSede: true, direccionFiscalSede: true,
        },
      });
    }

    // Enriquecer configuración con datos dinámicos (fuente: Empresa + Sede override)
    // ConfigDocumentos solo aporta: nombreComercial, logoUrl, colores, márgenes
    const configEnriquecida = {
      ...configuracion,
      // Datos fiscales dinámicos (NO copias estáticas)
      ruc:       sede?.rucSede             ?? empresa?.ruc            ?? null,
      direccion: sede?.direccionFiscalSede ?? empresa?.direccionFiscal ?? null,
      telefono:  sede?.telefono            ?? empresa?.telefono       ?? null,
      email:     sede?.email               ?? empresa?.email          ?? null,
      logoUrl:   configuracion.logoUrl     ?? empresa?.logo,
    };

    return {
      configuracion: configEnriquecida,
      plantilla,
      sede,
    };
  }

  /**
   * Crear configuracion y plantillas por defecto para una empresa nueva
   */
  async seedDefaults(empresaId: string) {
    // Check if already exists
    const existing = await this.prisma.configuracionDocumentos.findUnique({
      where: { empresaId },
    });

    if (existing) {
      this.logger.info('Document configuration already exists, skipping seed', {
        empresaId,
      });
      return;
    }

    // Consolidate data from empresa
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      include: {
        configuracionFacturacion: true,
        personalizaciones: { take: 1 },
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const personalizacion = empresa.personalizaciones?.[0];

    // Create config: solo datos de marca/estilo visual, NO copiar datos fiscales
    // (ruc, dirección, teléfono, email se leen dinámicamente de Empresa/Sede)
    const config = await this.prisma.configuracionDocumentos.create({
      data: {
        empresaId,
        logoUrl: empresa.logo ?? null,
        nombreComercial: empresa.nombre ?? null,
        colorPrimario: personalizacion?.colorPrimario ?? '#1565C0',
        colorSecundario: personalizacion?.colorSecundario ?? '#1E88E5',
        textoPiePagina: 'Gracias por su preferencia',
      },
    });

    // Create default templates
    for (const { tipo, nombre } of DEFAULT_PLANTILLAS) {
      await this.prisma.plantillaDocumento.create({
        data: {
          empresaId,
          configuracionDocId: config.id,
          tipoDocumento: tipo,
          formatoPapel: FormatoPapel.A4,
          nombre,
        },
      });
    }

    this.logger.info('Seeded default document configuration', { empresaId });
  }
}
