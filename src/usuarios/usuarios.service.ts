import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { QueryUsuarioDto } from './dto/query-usuario.dto';
import {
  UsuarioResponseDto,
  PaginatedUsuarioResponseDto,
} from './dto/usuario-response.dto';
import { createPaginatedResponse } from '../common/utils/pagination.util';

@Injectable()
export class UsuariosService {
  constructor(private prisma: PrismaService) {}

  /**
   * Obtener usuarios con filtros y paginación
   */
  async findAll(queryDto: QueryUsuarioDto): Promise<PaginatedUsuarioResponseDto> {
    const {
      page = 1,
      limit = 10,
      search,
      isActive,
      emailVerificado,
      rolGlobal,
      empresaId,
    } = queryDto;

    const skip = (page - 1) * limit;

    // Construir filtros dinámicos
    const where: any = {
      deletedAt: null,
    };

    // Filtro de búsqueda en múltiples campos
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { telefono: { contains: search, mode: 'insensitive' } },
        {
          persona: {
            OR: [
              { nombres: { contains: search, mode: 'insensitive' } },
              { apellidos: { contains: search, mode: 'insensitive' } },
              { dni: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    if (isActive !== undefined) where.isActive = isActive;
    if (emailVerificado !== undefined) where.emailVerificado = emailVerificado;
    if (rolGlobal) where.rolGlobal = rolGlobal;

    // Filtro por empresa (si se proporciona)
    if (empresaId) {
      where.empresas = {
        some: {
          empresaId,
          deletedAt: null,
        },
      };
    }

    const [usuarios, total] = await Promise.all([
      this.prisma.usuario.findMany({
        where,
        skip,
        take: limit,
        include: {
          persona: {
            select: {
              id: true,
              nombres: true,
              apellidos: true,
              dni: true,
            },
          },
          empresas: {
            where: { deletedAt: null },
            include: {
              empresa: {
                select: {
                  id: true,
                  nombre: true,
                },
              },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.usuario.count({ where }),
    ]);

    const data = usuarios.map((usuario) => this.toResponseDto(usuario));
    return createPaginatedResponse(data, total, page, limit);
  }

  /**
   * Obtener un usuario por ID
   */
  async findOne(id: string): Promise<UsuarioResponseDto> {
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        persona: {
          select: {
            id: true,
            nombres: true,
            apellidos: true,
            dni: true,
          },
        },
        empresas: {
          where: { deletedAt: null },
          include: {
            empresa: {
              select: {
                id: true,
                nombre: true,
              },
            },
          },
        },
      },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    return this.toResponseDto(usuario);
  }

  /**
   * Crear un nuevo usuario
   */
  async create(createDto: CreateUsuarioDto) {
    // TODO: Implementar creación de usuario
    return 'This action adds a new usuario';
  }

  /**
   * Actualizar un usuario
   */
  async update(id: string, updateDto: UpdateUsuarioDto) {
    // TODO: Implementar actualización de usuario
    return `This action updates a #${id} usuario`;
  }

  /**
   * Eliminar (soft delete) un usuario
   */
  async remove(id: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
    });

    if (!usuario) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    await this.prisma.usuario.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: 'Usuario eliminado exitosamente' };
  }

  /**
   * Mapea un usuario de Prisma a DTO de respuesta
   */
  private toResponseDto(usuario: any): UsuarioResponseDto {
    return {
      id: usuario.id,
      email: usuario.email,
      telefono: usuario.telefono,
      isActive: usuario.isActive,
      emailVerificado: usuario.emailVerificado,
      telefonoVerificado: usuario.telefonoVerificado,
      rolGlobal: usuario.rolGlobal,
      lastLoginAt: usuario.lastLoginAt,
      creadoEn: usuario.creadoEn,
      actualizadoEn: usuario.actualizadoEn,
      persona: usuario.persona
        ? {
            id: usuario.persona.id,
            nombres: usuario.persona.nombres,
            apellidos: usuario.persona.apellidos,
            dni: usuario.persona.dni,
          }
        : undefined,
      empresas: usuario.empresas?.map((er: any) => ({
        id: er.id,
        empresaId: er.empresaId,
        empresaNombre: er.empresa?.nombre,
        rol: er.rol,
        isActive: er.isActive,
        estado: er.estado,
      })),
    };
  }
}
