import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreatePlantillaServicioDto } from './dto/create-plantilla-servicio.dto';
import { UpdatePlantillaServicioDto } from './dto/update-plantilla-servicio.dto';

@Injectable()
export class PlantillaServicioService {
  constructor(private prisma: PrismaService) {}

  async create(empresaId: string, dto: CreatePlantillaServicioDto) {
    const { campos, ...plantillaData } = dto;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Crear la plantilla directamente — la constraint unique manejará duplicados
        const plantilla = await tx.plantillaServicio.create({
          data: {
            empresaId,
            ...plantillaData,
          },
        });

        // Crear campos si se proporcionan
        if (campos && campos.length > 0) {
          await tx.configuracionCamposServicio.createMany({
            data: campos.map((campo, index) => ({
              empresaId,
              plantillaId: plantilla.id,
              nombre: campo.nombre,
              tipoCampo: campo.tipoCampo,
              categoria: campo.categoria,
              descripcion: campo.descripcion,
              placeholder: campo.placeholder,
              esRequerido: campo.esRequerido ?? false,
              defaultValue: campo.defaultValue,
              opciones: campo.opciones,
              permiteOtro: campo.permiteOtro ?? false,
              orden: campo.orden ?? index + 1,
            })),
          });
        }

        // Retornar con campos incluidos
        return tx.plantillaServicio.findUnique({
          where: { id: plantilla.id },
          include: {
            campos: {
              where: { isActive: true },
              orderBy: { orden: 'asc' },
            },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Ya existe una plantilla con el nombre "${dto.nombre}"`,
        );
      }
      throw error;
    }
  }

  async findAll(empresaId: string) {
    return this.prisma.plantillaServicio.findMany({
      where: { empresaId, isActive: true },
      include: {
        campos: {
          where: { isActive: true },
          orderBy: { orden: 'asc' },
        },
        _count: {
          select: { servicios: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(empresaId: string, id: string) {
    const plantilla = await this.prisma.plantillaServicio.findFirst({
      where: { id, empresaId },
      include: {
        campos: {
          where: { isActive: true },
          orderBy: { orden: 'asc' },
        },
        servicios: {
          where: { isActive: true, deletedAt: null },
          select: { id: true, nombre: true, codigoEmpresa: true },
        },
      },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    return plantilla;
  }

  async update(empresaId: string, id: string, dto: UpdatePlantillaServicioDto) {
    await this.findOne(empresaId, id);

    // Si cambia el nombre, verificar unicidad
    if (dto.nombre) {
      const existing = await this.prisma.plantillaServicio.findFirst({
        where: {
          empresaId,
          nombre: dto.nombre,
          id: { not: id },
        },
      });

      if (existing) {
        throw new BadRequestException(
          `Ya existe una plantilla con el nombre "${dto.nombre}"`,
        );
      }
    }

    return this.prisma.plantillaServicio.update({
      where: { id },
      data: dto,
      include: {
        campos: {
          where: { isActive: true },
          orderBy: { orden: 'asc' },
        },
      },
    });
  }

  async remove(empresaId: string, id: string) {
    await this.findOne(empresaId, id);

    return this.prisma.plantillaServicio.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // Agregar un campo a la plantilla
  async addCampo(empresaId: string, plantillaId: string, campoData: any) {
    await this.findOne(empresaId, plantillaId);

    // El unique es (empresaId, plantillaId, nombre) y NO distingue activos
    // de inactivos. Sin este chequeo el choque salía como 500 opaco, y el
    // caso "elimino el campo y lo vuelvo a agregar" era imposible: el
    // borrado es lógico, así que la fila seguía ocupando el nombre.
    const existente = await this.prisma.configuracionCamposServicio.findFirst({
      where: { empresaId, plantillaId, nombre: campoData.nombre },
      select: { id: true, isActive: true, tipoCampo: true, orden: true },
    });

    if (existente?.isActive) {
      throw new ConflictException(
        `Ya existe un campo "${campoData.nombre}" en esta plantilla ` +
          `(tipo ${existente.tipoCampo}). Edítalo si quieres cambiarle el tipo.`,
      );
    }

    // Auto-orden
    if (campoData.orden === undefined) {
      const maxOrden = await this.prisma.configuracionCamposServicio.findFirst({
        where: { plantillaId, isActive: true },
        orderBy: { orden: 'desc' },
        select: { orden: true },
      });
      campoData.orden = (maxOrden?.orden ?? 0) + 1;
    }

    // Existía pero desactivado: se revive con la definición nueva. Es lo que
    // el usuario quiere decir al re-agregarlo, y evita obligarlo a inventar
    // otro nombre por una fila que ya no ve.
    if (existente) {
      return this.prisma.configuracionCamposServicio.update({
        where: { id: existente.id },
        data: { ...campoData, isActive: true },
      });
    }

    return this.prisma.configuracionCamposServicio.create({
      data: {
        empresaId,
        plantillaId,
        ...campoData,
      },
    });
  }

  // Obtener campos de una plantilla (para usar al crear orden)
  async getCamposByPlantillaId(empresaId: string, plantillaId: string) {
    return this.prisma.configuracionCamposServicio.findMany({
      where: {
        empresaId,
        plantillaId,
        isActive: true,
      },
      orderBy: { orden: 'asc' },
    });
  }

  // Obtener campos por servicioId (busca la plantilla vinculada al servicio)
  async getCamposByServicioId(empresaId: string, servicioId: string) {
    const servicio = await this.prisma.servicio.findFirst({
      where: { id: servicioId, empresaId },
      select: { plantillaServicioId: true },
    });

    if (!servicio?.plantillaServicioId) {
      return [];
    }

    return this.getCamposByPlantillaId(empresaId, servicio.plantillaServicioId);
  }
}
