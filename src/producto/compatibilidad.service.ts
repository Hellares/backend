import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreateReglaCompatibilidadDto } from './dto/create-regla-compatibilidad.dto';
import { UpdateReglaCompatibilidadDto } from './dto/update-regla-compatibilidad.dto';
import { ProductoCompatibilidadItem } from './dto/validar-compatibilidad.dto';
import { TipoValidacionCompatibilidad } from '@prisma/client';

export interface ConflictoCompatibilidad {
  regla: { id: string; nombre: string };
  productoOrigen: { id: string; nombre: string; categoriaId: string };
  productoDestino: { id: string; nombre: string; categoriaId: string };
  atributoClave: string;
  valorOrigen: string;
  valorDestino: string;
  mensaje: string;
}

export interface ResultadoCompatibilidad {
  compatible: boolean;
  conflictos: ConflictoCompatibilidad[];
}

@Injectable()
export class CompatibilidadService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CompatibilidadService.name);
  }

  /**
   * Crear una regla de compatibilidad
   */
  async create(empresaId: string, dto: CreateReglaCompatibilidadDto) {
    this.logger.info('Creating compatibility rule', { empresaId, nombre: dto.nombre });

    // Validar que las categorías existan y pertenezcan a la empresa
    const [categoriaOrigen, categoriaDestino] = await Promise.all([
      this.prisma.empresaCategoria.findFirst({
        where: { id: dto.categoriaOrigenId, empresaId, isActive: true },
      }),
      this.prisma.empresaCategoria.findFirst({
        where: { id: dto.categoriaDestinoId, empresaId, isActive: true },
      }),
    ]);

    if (!categoriaOrigen) {
      throw new NotFoundException('La categoría origen no existe o no está activa');
    }
    if (!categoriaDestino) {
      throw new NotFoundException('La categoría destino no existe o no está activa');
    }

    // Validar que las claves de atributo existan en la empresa
    const [atributoOrigen, atributoDestino] = await Promise.all([
      this.prisma.productoAtributo.findFirst({
        where: { empresaId, clave: dto.atributoOrigenClave, isActive: true },
      }),
      this.prisma.productoAtributo.findFirst({
        where: { empresaId, clave: dto.atributoDestinoClave, isActive: true },
      }),
    ]);

    if (!atributoOrigen) {
      throw new NotFoundException(`No existe un atributo activo con la clave: ${dto.atributoOrigenClave}`);
    }
    if (!atributoDestino) {
      throw new NotFoundException(`No existe un atributo activo con la clave: ${dto.atributoDestinoClave}`);
    }

    // Validar mapeoValores si tipoValidacion es INCLUYE_EN
    if (dto.tipoValidacion === TipoValidacionCompatibilidad.INCLUYE_EN && !dto.mapeoValores) {
      throw new BadRequestException('mapeoValores es requerido cuando tipoValidacion es INCLUYE_EN');
    }

    try {
      const regla = await this.prisma.reglaCompatibilidad.create({
        data: {
          empresaId,
          nombre: dto.nombre,
          descripcion: dto.descripcion,
          atributoOrigenClave: dto.atributoOrigenClave,
          categoriaOrigenId: dto.categoriaOrigenId,
          atributoDestinoClave: dto.atributoDestinoClave,
          categoriaDestinoId: dto.categoriaDestinoId,
          tipoValidacion: dto.tipoValidacion ?? TipoValidacionCompatibilidad.IGUAL,
          mapeoValores: dto.mapeoValores ? JSON.stringify(dto.mapeoValores) : null,
        },
        include: {
          categoriaOrigen: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
          categoriaDestino: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
        },
      });

      this.logger.log(`Regla de compatibilidad creada: ${regla.id}`);
      return regla;
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Ya existe una regla con los mismos atributos y categorías');
      }
      throw error;
    }
  }

  /**
   * Listar reglas de compatibilidad
   */
  async findAll(empresaId: string, categoriaId?: string) {
    const where: any = { empresaId, isActive: true };

    if (categoriaId) {
      where.OR = [
        { categoriaOrigenId: categoriaId },
        { categoriaDestinoId: categoriaId },
      ];
    }

    return this.prisma.reglaCompatibilidad.findMany({
      where,
      include: {
        categoriaOrigen: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
        categoriaDestino: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  /**
   * Obtener regla por ID
   */
  async findOne(id: string, empresaId: string) {
    const regla = await this.prisma.reglaCompatibilidad.findFirst({
      where: { id, empresaId },
      include: {
        categoriaOrigen: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
        categoriaDestino: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
      },
    });

    if (!regla) {
      throw new NotFoundException('Regla de compatibilidad no encontrada');
    }

    return regla;
  }

  /**
   * Actualizar regla de compatibilidad
   */
  async update(id: string, empresaId: string, dto: UpdateReglaCompatibilidadDto) {
    const regla = await this.prisma.reglaCompatibilidad.findFirst({
      where: { id, empresaId },
    });

    if (!regla) {
      throw new NotFoundException('Regla de compatibilidad no encontrada');
    }

    // Si cambian categorías, validarlas
    if (dto.categoriaOrigenId) {
      const cat = await this.prisma.empresaCategoria.findFirst({
        where: { id: dto.categoriaOrigenId, empresaId, isActive: true },
      });
      if (!cat) throw new NotFoundException('La categoría origen no existe o no está activa');
    }
    if (dto.categoriaDestinoId) {
      const cat = await this.prisma.empresaCategoria.findFirst({
        where: { id: dto.categoriaDestinoId, empresaId, isActive: true },
      });
      if (!cat) throw new NotFoundException('La categoría destino no existe o no está activa');
    }

    // Si cambian claves de atributo, validarlas
    if (dto.atributoOrigenClave) {
      const attr = await this.prisma.productoAtributo.findFirst({
        where: { empresaId, clave: dto.atributoOrigenClave, isActive: true },
      });
      if (!attr) throw new NotFoundException(`No existe un atributo activo con la clave: ${dto.atributoOrigenClave}`);
    }
    if (dto.atributoDestinoClave) {
      const attr = await this.prisma.productoAtributo.findFirst({
        where: { empresaId, clave: dto.atributoDestinoClave, isActive: true },
      });
      if (!attr) throw new NotFoundException(`No existe un atributo activo con la clave: ${dto.atributoDestinoClave}`);
    }

    const tipoValidacion = dto.tipoValidacion ?? regla.tipoValidacion;
    if (tipoValidacion === TipoValidacionCompatibilidad.INCLUYE_EN && dto.mapeoValores === undefined && !regla.mapeoValores) {
      throw new BadRequestException('mapeoValores es requerido cuando tipoValidacion es INCLUYE_EN');
    }

    try {
      return await this.prisma.reglaCompatibilidad.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined && { nombre: dto.nombre }),
          ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
          ...(dto.atributoOrigenClave !== undefined && { atributoOrigenClave: dto.atributoOrigenClave }),
          ...(dto.categoriaOrigenId !== undefined && { categoriaOrigenId: dto.categoriaOrigenId }),
          ...(dto.atributoDestinoClave !== undefined && { atributoDestinoClave: dto.atributoDestinoClave }),
          ...(dto.categoriaDestinoId !== undefined && { categoriaDestinoId: dto.categoriaDestinoId }),
          ...(dto.tipoValidacion !== undefined && { tipoValidacion: dto.tipoValidacion }),
          ...(dto.mapeoValores !== undefined && { mapeoValores: JSON.stringify(dto.mapeoValores) }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        include: {
          categoriaOrigen: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
          categoriaDestino: { select: { id: true, nombrePersonalizado: true, nombreLocal: true } },
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Ya existe una regla con los mismos atributos y categorías');
      }
      throw error;
    }
  }

  /**
   * Soft delete de regla
   */
  async remove(id: string, empresaId: string) {
    const regla = await this.prisma.reglaCompatibilidad.findFirst({
      where: { id, empresaId },
    });

    if (!regla) {
      throw new NotFoundException('Regla de compatibilidad no encontrada');
    }

    await this.prisma.reglaCompatibilidad.update({
      where: { id },
      data: { isActive: false },
    });

    return { message: 'Regla de compatibilidad eliminada exitosamente' };
  }

  /**
   * MÉTODO PRINCIPAL: Validar compatibilidad entre productos
   */
  async validarCompatibilidad(
    empresaId: string,
    productos: ProductoCompatibilidadItem[],
  ): Promise<ResultadoCompatibilidad> {
    if (productos.length < 2) {
      return { compatible: true, conflictos: [] };
    }

    // 1. Cargar productos con sus atributos y categorías
    const productoIds = productos
      .filter((p) => p.productoId)
      .map((p) => p.productoId);
    const varianteIds = productos
      .filter((p) => p.varianteId)
      .map((p) => p.varianteId);

    const productosDb = await this.prisma.producto.findMany({
      where: {
        empresaId,
        id: { in: productoIds as string[] },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        nombre: true,
        empresaCategoriaId: true,
        atributosValores: {
          select: {
            valor: true,
            atributo: { select: { clave: true, nombre: true } },
          },
        },
      },
    });

    // También cargar variantes si hay
    const variantesDb = varianteIds.length > 0
      ? await this.prisma.productoVariante.findMany({
          where: {
            empresaId,
            id: { in: varianteIds as string[] },
            isActive: true,
            deletedAt: null,
          },
          select: {
            id: true,
            nombre: true,
            producto: {
              select: { id: true, nombre: true, empresaCategoriaId: true },
            },
            atributosValores: {
              select: {
                valor: true,
                atributo: { select: { clave: true, nombre: true } },
              },
            },
          },
        })
      : [];

    // Normalizar todos los items a una estructura común
    interface ItemNormalizado {
      id: string;
      nombre: string;
      categoriaId: string | null;
      atributos: Map<string, string>;
    }

    const items: ItemNormalizado[] = [];

    for (const p of productosDb) {
      const atributos = new Map<string, string>();
      for (const av of p.atributosValores) {
        atributos.set(av.atributo.clave, av.valor);
      }
      items.push({
        id: p.id,
        nombre: p.nombre,
        categoriaId: p.empresaCategoriaId,
        atributos,
      });
    }

    for (const v of variantesDb) {
      const atributos = new Map<string, string>();
      for (const av of v.atributosValores) {
        atributos.set(av.atributo.clave, av.valor);
      }
      items.push({
        id: v.id,
        nombre: v.nombre,
        categoriaId: v.producto.empresaCategoriaId,
        atributos,
      });
    }

    // 2. Obtener categorías de los items cargados
    const categoriaIds = [...new Set(items.map((i) => i.categoriaId).filter(Boolean))] as string[];

    if (categoriaIds.length === 0) {
      return { compatible: true, conflictos: [] };
    }

    // 3. Cargar reglas activas que aplican
    const reglas = await this.prisma.reglaCompatibilidad.findMany({
      where: {
        empresaId,
        isActive: true,
        categoriaOrigenId: { in: categoriaIds },
        categoriaDestinoId: { in: categoriaIds },
      },
    });

    if (reglas.length === 0) {
      return { compatible: true, conflictos: [] };
    }

    // 4. Evaluar reglas para cada par de productos
    const conflictos: ConflictoCompatibilidad[] = [];

    for (const regla of reglas) {
      const itemsOrigen = items.filter((i) => i.categoriaId === regla.categoriaOrigenId);
      const itemsDestino = items.filter((i) => i.categoriaId === regla.categoriaDestinoId);

      for (const origen of itemsOrigen) {
        for (const destino of itemsDestino) {
          // No comparar un producto consigo mismo
          if (origen.id === destino.id) continue;

          const valorOrigen = origen.atributos.get(regla.atributoOrigenClave);
          const valorDestino = destino.atributos.get(regla.atributoDestinoClave);

          // Si alguno no tiene el atributo, skip
          if (!valorOrigen || !valorDestino) continue;

          let esCompatible = false;

          if (regla.tipoValidacion === TipoValidacionCompatibilidad.IGUAL) {
            esCompatible = valorOrigen === valorDestino;
          } else if (regla.tipoValidacion === TipoValidacionCompatibilidad.INCLUYE_EN) {
            try {
              const mapeo = JSON.parse(regla.mapeoValores || '{}') as Record<string, string[]>;
              const valoresPermitidos = mapeo[valorOrigen];
              esCompatible = valoresPermitidos ? valoresPermitidos.includes(valorDestino) : false;
            } catch {
              esCompatible = false;
            }
          }

          if (!esCompatible) {
            conflictos.push({
              regla: { id: regla.id, nombre: regla.nombre },
              productoOrigen: {
                id: origen.id,
                nombre: origen.nombre,
                categoriaId: origen.categoriaId!,
              },
              productoDestino: {
                id: destino.id,
                nombre: destino.nombre,
                categoriaId: destino.categoriaId!,
              },
              atributoClave: regla.atributoOrigenClave,
              valorOrigen,
              valorDestino,
              mensaje: `El ${regla.atributoOrigenClave} de ${origen.nombre} (${valorOrigen}) no es compatible con el ${regla.atributoDestinoClave} de ${destino.nombre} (${valorDestino})`,
            });
          }
        }
      }
    }

    return {
      compatible: conflictos.length === 0,
      conflictos,
    };
  }

  /**
   * Validación rápida: ¿son compatibles dos productos?
   */
  async sonCompatibles(
    empresaId: string,
    productoAId: string,
    productoBId: string,
  ): Promise<boolean> {
    const resultado = await this.validarCompatibilidad(empresaId, [
      { productoId: productoAId },
      { productoId: productoBId },
    ]);
    return resultado.compatible;
  }
}
