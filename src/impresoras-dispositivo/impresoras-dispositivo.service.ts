import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ImpresorasDispositivoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Config de impresoras guardada para un dispositivo (vacía si no hay). */
  async obtener(empresaId: string, deviceId: string) {
    const row = await this.prisma.impresoraDispositivo.findUnique({
      where: { empresaId_deviceId: { empresaId, deviceId } },
    });
    return {
      config: row?.config ?? [],
      actualizadoEn: row?.actualizadoEn ?? null,
    };
  }

  /** Crea o reemplaza la lista de impresoras del dispositivo. */
  async guardar(empresaId: string, deviceId: string, config: any[]) {
    const row = await this.prisma.impresoraDispositivo.upsert({
      where: { empresaId_deviceId: { empresaId, deviceId } },
      create: { empresaId, deviceId, config },
      update: { config },
    });
    return { config: row.config, actualizadoEn: row.actualizadoEn };
  }
}
