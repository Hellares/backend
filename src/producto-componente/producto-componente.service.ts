import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CrearComponenteDto, ActualizarComponenteDto } from './dto';

/**
 * Módulo Producto Compuesto / BOM (Bill of Materials).
 *
 * MVP: solo calculadora de costo a partir de los componentes definidos.
 * No descuenta stock — la "fabricación" formal es trabajo futuro.
 */
@Injectable()
export class ProductoComponenteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista los componentes de un producto final, incluyendo nombre,
   * unidad y precioCosto del componente en la sede indicada (para que
   * el frontend pueda mostrar costo unitario y subtotal sin queries extras).
   */
  async listar(empresaId: string, productoId: string, sedeId?: string) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId },
      orderBy: { creadoEn: 'asc' },
      include: {
        componente: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            unidadMedida: {
              select: {
                id: true,
                nombrePersonalizado: true,
                simboloPersonalizado: true,
                nombreLocal: true,
                simboloLocal: true,
                unidadMaestra: { select: { nombre: true, simbolo: true } },
              },
            },
          },
        },
      },
    });

    // Si no se pasó sede, intento detectar la única sede del producto
    // final para hidratar costos sin pedirle al usuario una sede explícita.
    const sedeResuelta = sedeId ?? (await this._sedeUnicaDelProducto(productoId));

    const stocksMap = sedeResuelta
      ? await this._costosPorComponente(
          componentes.map((c) => c.componenteId),
          sedeResuelta,
        )
      : new Map<string, number | null>();

    return componentes.map((c) => {
      const cantidad = Number(c.cantidad);
      const costoUnit = stocksMap.get(c.componenteId) ?? null;
      const subtotal =
        costoUnit != null ? +(cantidad * costoUnit).toFixed(4) : null;
      const um = c.componente.unidadMedida;
      // Resolución del símbolo/nombre: local override > personalizado > maestra.
      const simbolo =
        um?.simboloLocal ??
        um?.simboloPersonalizado ??
        um?.unidadMaestra?.simbolo ??
        null;
      const nombreUM =
        um?.nombreLocal ??
        um?.nombrePersonalizado ??
        um?.unidadMaestra?.nombre ??
        null;
      return {
        id: c.id,
        productoId: c.productoId,
        componenteId: c.componenteId,
        cantidad,
        notas: c.notas,
        componente: {
          id: c.componente.id,
          nombre: c.componente.nombre,
          codigoEmpresa: c.componente.codigoEmpresa,
          unidadMedida: simbolo,
          unidadMedidaNombre: nombreUM,
        },
        precioCostoUnitario: costoUnit,
        subtotal,
        sedeUsada: sedeResuelta ?? null,
      };
    });
  }

  /**
   * Calcula el costo sugerido del producto final sumando
   * (cantidad × precioCosto) de cada componente en la sede indicada.
   * Si algún componente no tiene precioCosto en esa sede, lo reporta
   * en `componentesSinCosto` y NO lo cuenta — el total sería parcial.
   */
  async calcularCosto(empresaId: string, productoId: string, sedeId: string) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId },
      include: { componente: { select: { id: true, nombre: true } } },
    });

    if (componentes.length === 0) {
      return {
        costoTotal: 0,
        cantidadComponentes: 0,
        componentesSinCosto: [],
        sedeId,
      };
    }

    const costosMap = await this._costosPorComponente(
      componentes.map((c) => c.componenteId),
      sedeId,
    );

    let total = 0;
    const sinCosto: { id: string; nombre: string }[] = [];

    for (const c of componentes) {
      const costo = costosMap.get(c.componenteId);
      if (costo == null) {
        sinCosto.push({ id: c.componente.id, nombre: c.componente.nombre });
        continue;
      }
      total += Number(c.cantidad) * costo;
    }

    return {
      costoTotal: +total.toFixed(4),
      cantidadComponentes: componentes.length,
      componentesSinCosto: sinCosto,
      sedeId,
    };
  }

  async crear(
    empresaId: string,
    productoId: string,
    dto: CrearComponenteDto,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    // Validaciones de integridad
    if (dto.componenteId === productoId) {
      throw new BadRequestException(
        'Un producto no puede ser componente de sí mismo',
      );
    }
    await this._assertProductoPerteneceAEmpresa(empresaId, dto.componenteId);

    // Detectar ciclo directo (el componente ya usa al producto como insumo)
    const ciclo = await this.prisma.productoComponente.findFirst({
      where: { productoId: dto.componenteId, componenteId: productoId },
      select: { id: true },
    });
    if (ciclo) {
      throw new BadRequestException(
        'Ciclo detectado: el componente seleccionado ya usa este producto como insumo',
      );
    }

    try {
      const nuevo = await this.prisma.productoComponente.create({
        data: {
          productoId,
          componenteId: dto.componenteId,
          cantidad: new Prisma.Decimal(dto.cantidad),
          notas: dto.notas,
        },
      });
      return nuevo;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ese componente ya está en la receta de este producto',
        );
      }
      throw e;
    }
  }

  async actualizar(
    empresaId: string,
    productoId: string,
    componenteRowId: string,
    dto: ActualizarComponenteDto,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const existente = await this.prisma.productoComponente.findUnique({
      where: { id: componenteRowId },
    });
    if (!existente || existente.productoId !== productoId) {
      throw new NotFoundException('Componente no encontrado en este producto');
    }

    return this.prisma.productoComponente.update({
      where: { id: componenteRowId },
      data: {
        cantidad:
          dto.cantidad != null ? new Prisma.Decimal(dto.cantidad) : undefined,
        notas: dto.notas,
      },
    });
  }

  async eliminar(
    empresaId: string,
    productoId: string,
    componenteRowId: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const existente = await this.prisma.productoComponente.findUnique({
      where: { id: componenteRowId },
    });
    if (!existente || existente.productoId !== productoId) {
      throw new NotFoundException('Componente no encontrado en este producto');
    }

    await this.prisma.productoComponente.delete({
      where: { id: componenteRowId },
    });
    return { id: componenteRowId };
  }

  // ─── helpers privados ─────────────────────────────────────────

  private async _assertProductoPerteneceAEmpresa(
    empresaId: string,
    productoId: string,
  ) {
    const p = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true },
    });
    if (!p) {
      throw new NotFoundException('Producto no encontrado en esta empresa');
    }
  }

  /**
   * Devuelve `Map<componenteId, precioCosto>` para una sede dada.
   * Si un componente no tiene stock registrado en esa sede, lo omite
   * (el caller decide qué hacer con el faltante).
   */
  private async _costosPorComponente(
    componenteIds: string[],
    sedeId: string,
  ): Promise<Map<string, number>> {
    if (componenteIds.length === 0) return new Map();
    const stocks = await this.prisma.productoStock.findMany({
      where: {
        sedeId,
        productoId: { in: componenteIds },
        varianteId: null,
      },
      select: { productoId: true, precioCosto: true },
    });
    const map = new Map<string, number>();
    for (const s of stocks) {
      if (s.productoId && s.precioCosto != null) {
        map.set(s.productoId, Number(s.precioCosto));
      }
    }
    return map;
  }

  /**
   * Si el producto solo está activo en 1 sede, devuelve esa sede.
   * Usado para que el frontend no tenga que pedir sedeId explícito
   * cuando solo hay una opción posible.
   */
  private async _sedeUnicaDelProducto(
    productoId: string,
  ): Promise<string | null> {
    const sedes = await this.prisma.productoStock.findMany({
      where: { productoId, varianteId: null },
      select: { sedeId: true },
      distinct: ['sedeId'],
      take: 2,
    });
    if (sedes.length === 1) return sedes[0].sedeId;
    return null;
  }
}
