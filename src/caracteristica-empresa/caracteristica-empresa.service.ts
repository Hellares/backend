import { Injectable } from '@nestjs/common';
import { CaracteristicaPremium, OrigenCaracteristica } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gating de características PREMIUM por empresa (feature flags con vigencia).
 * El super admin las activa/desactiva; el runtime sólo consulta `estaHabilitada`.
 * Gate: existe row + habilitado + (sin vencimiento o vencimiento futuro).
 */
@Injectable()
export class CaracteristicaEmpresaService {
  constructor(private readonly prisma: PrismaService) {}

  /** ¿La empresa tiene la característica vigente AHORA? (gate de runtime) */
  async estaHabilitada(
    empresaId: string,
    caracteristica: CaracteristicaPremium,
  ): Promise<boolean> {
    const c = await this.prisma.empresaCaracteristica.findUnique({
      where: { empresaId_caracteristica: { empresaId, caracteristica } },
      select: { habilitado: true, vigenteHasta: true },
    });
    if (!c || !c.habilitado) return false;
    if (c.vigenteHasta && c.vigenteHasta.getTime() <= Date.now()) return false;
    return true;
  }

  /**
   * Mapa { caracteristica: boolean } con el estado VIGENTE de todas las features
   * conocidas para una empresa. Para exponer en /context (el front muestra/oculta).
   */
  async mapaHabilitadas(
    empresaId: string,
  ): Promise<Record<CaracteristicaPremium, boolean>> {
    const rows = await this.prisma.empresaCaracteristica.findMany({
      where: { empresaId },
      select: { caracteristica: true, habilitado: true, vigenteHasta: true },
    });
    const now = Date.now();
    const vigente = (r: { habilitado: boolean; vigenteHasta: Date | null }) =>
      r.habilitado && (!r.vigenteHasta || r.vigenteHasta.getTime() > now);
    const mapa = {} as Record<CaracteristicaPremium, boolean>;
    for (const key of Object.values(CaracteristicaPremium)) mapa[key] = false;
    for (const r of rows) mapa[r.caracteristica] = vigente(r);
    return mapa;
  }

  /** Lista las características de una empresa (para el panel admin). */
  async listarPorEmpresa(empresaId: string) {
    return this.prisma.empresaCaracteristica.findMany({
      where: { empresaId },
      orderBy: { caracteristica: 'asc' },
    });
  }

  /**
   * Crea o actualiza una característica de la empresa (acción del super admin).
   * `vigenteHasta` null = permanente. Devuelve la fila resultante.
   */
  async upsert(
    empresaId: string,
    caracteristica: CaracteristicaPremium,
    data: {
      habilitado?: boolean;
      vigenteHasta?: Date | null;
      origen?: OrigenCaracteristica;
      notaAdmin?: string | null;
      otorgadoPorId?: string | null;
    },
  ) {
    return this.prisma.empresaCaracteristica.upsert({
      where: { empresaId_caracteristica: { empresaId, caracteristica } },
      update: {
        ...(data.habilitado !== undefined && { habilitado: data.habilitado }),
        ...(data.vigenteHasta !== undefined && { vigenteHasta: data.vigenteHasta }),
        ...(data.origen !== undefined && { origen: data.origen }),
        ...(data.notaAdmin !== undefined && { notaAdmin: data.notaAdmin }),
        ...(data.otorgadoPorId !== undefined && { otorgadoPorId: data.otorgadoPorId }),
      },
      create: {
        empresaId,
        caracteristica,
        habilitado: data.habilitado ?? true,
        vigenteHasta: data.vigenteHasta ?? null,
        origen: data.origen ?? OrigenCaracteristica.ADMIN,
        notaAdmin: data.notaAdmin ?? null,
        otorgadoPorId: data.otorgadoPorId ?? null,
      },
    });
  }
}
