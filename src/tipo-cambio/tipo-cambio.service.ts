import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TipoCambioService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consultasExternas: ConsultasExternasService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(TipoCambioService.name);
  }

  /**
   * Get today's exchange rate (from DB or API)
   */
  async getHoy(empresaId: string) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);

    // Check if we already have today's rate
    let tipoCambio = await this.prisma.tipoCambio.findFirst({
      where: {
        empresaId,
        monedaOrigen: 'USD',
        monedaDestino: 'PEN',
        fecha: { gte: hoy, lt: manana },
      },
      orderBy: { fecha: 'desc' },
    });

    if (!tipoCambio) {
      // Try to fetch from API and save
      try {
        const apiRate = await this.consultasExternas.consultarTipoCambio();
        tipoCambio = await this.prisma.tipoCambio.create({
          data: {
            empresaId,
            monedaOrigen: 'USD',
            monedaDestino: 'PEN',
            tasaCompra: apiRate.compra,
            tasaVenta: apiRate.venta,
            fecha: new Date(),
            fuente: 'API',
          },
        });
      } catch (error) {
        // If API fails, return the most recent rate
        tipoCambio = await this.prisma.tipoCambio.findFirst({
          where: { empresaId, monedaOrigen: 'USD', monedaDestino: 'PEN' },
          orderBy: { fecha: 'desc' },
        });
        if (!tipoCambio) {
          return null;
        }
      }
    }

    return {
      id: tipoCambio.id,
      compra: Number(tipoCambio.tasaCompra),
      venta: Number(tipoCambio.tasaVenta),
      fecha: tipoCambio.fecha,
      fuente: tipoCambio.fuente,
    };
  }

  /**
   * Get historical exchange rates
   */
  async getHistorial(empresaId: string, filtros?: { fechaDesde?: string; fechaHasta?: string; limit?: number }) {
    const where: any = { empresaId, monedaOrigen: 'USD', monedaDestino: 'PEN' };

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fecha = {};
      if (filtros.fechaDesde) where.fecha.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) where.fecha.lte = new Date(filtros.fechaHasta);
    }

    const registros = await this.prisma.tipoCambio.findMany({
      where,
      orderBy: { fecha: 'desc' },
      take: filtros?.limit ?? 30,
    });

    return registros.map(r => ({
      id: r.id,
      compra: Number(r.tasaCompra),
      venta: Number(r.tasaVenta),
      fecha: r.fecha,
      fuente: r.fuente,
    }));
  }

  /**
   * Manually register an exchange rate
   */
  async registrarManual(empresaId: string, dto: { compra: number; venta: number; fecha?: string }) {
    const fecha = dto.fecha ? new Date(dto.fecha) : new Date();

    return this.prisma.tipoCambio.create({
      data: {
        empresaId,
        monedaOrigen: 'USD',
        monedaDestino: 'PEN',
        tasaCompra: dto.compra,
        tasaVenta: dto.venta,
        fecha,
        fuente: 'MANUAL',
      },
    });
  }

  /**
   * Auto-sync exchange rate daily at 9 AM for all active companies
   */
  @Cron('0 9 * * 1-6') // Mon-Sat at 9 AM
  async sincronizarAutomatico() {
    try {
      const apiRate = await this.consultasExternas.consultarTipoCambio();

      // Get all active companies with USD in monedasPermitidas
      const empresas = await this.prisma.configuracionEmpresa.findMany({
        where: { monedasPermitidas: { has: 'USD' } },
        select: { empresaId: true },
      });

      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const manana = new Date(hoy);
      manana.setDate(manana.getDate() + 1);

      for (const { empresaId } of empresas) {
        // Skip if already has today's API rate
        const existing = await this.prisma.tipoCambio.findFirst({
          where: {
            empresaId,
            monedaOrigen: 'USD',
            monedaDestino: 'PEN',
            fuente: 'API',
            fecha: { gte: hoy, lt: manana },
          },
        });

        if (!existing) {
          await this.prisma.tipoCambio.create({
            data: {
              empresaId,
              monedaOrigen: 'USD',
              monedaDestino: 'PEN',
              tasaCompra: apiRate.compra,
              tasaVenta: apiRate.venta,
              fecha: new Date(),
              fuente: 'API',
            },
          });
        }
      }

      this.logger.info(`Tipo de cambio sincronizado para ${empresas.length} empresas`);
    } catch (error) {
      this.logger.error(`Error sincronizando tipo de cambio: ${error.message}`);
    }
  }

  /**
   * Get currency config for a company
   */
  async getConfiguracion(empresaId: string) {
    const config = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
      select: {
        monedaPrincipal: true,
        simboloMoneda: true,
        monedasPermitidas: true,
      },
    });

    return config ?? { monedaPrincipal: 'PEN', simboloMoneda: 'S/', monedasPermitidas: ['PEN', 'USD'] };
  }
}
