import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import {
  CreateClienteEmpresaDto,
  UpdateClienteEmpresaDto,
  QueryClienteEmpresaDto,
} from './dto';
import { CreateClienteEmpresaContactoDto } from './dto/create-cliente-empresa.dto';

@Injectable()
export class ClienteEmpresaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracionCodigosService: ConfiguracionCodigosService,
  ) {}

  async create(data: CreateClienteEmpresaDto) {
    if (!data.empresaId || !data.creadoPor) {
      throw new BadRequestException(
        'empresaId y creadoPor son requeridos',
      );
    }

    // Verificar duplicado por número de documento
    const existente = await this.prisma.clienteEmpresa.findUnique({
      where: {
        empresaId_numeroDocumento: {
          empresaId: data.empresaId,
          numeroDocumento: data.numeroDocumento,
        },
      },
    });

    if (existente) {
      throw new ConflictException(
        `Ya existe un cliente empresa con el documento ${data.numeroDocumento}`,
      );
    }

    // Generar código automático
    const { codigoClienteEmpresa: codigo } =
      await this.configuracionCodigosService.generarCodigoClienteEmpresa(
        data.empresaId,
      );

    return this.prisma.clienteEmpresa.create({
      data: {
        empresaId: data.empresaId,
        codigo,
        razonSocial: data.razonSocial,
        nombreComercial: data.nombreComercial,
        tipoDocumento: data.tipoDocumento ?? 'RUC',
        numeroDocumento: data.numeroDocumento,
        email: data.email,
        telefono: data.telefono,
        telefonoAlternativo: data.telefonoAlternativo,
        sitioWeb: data.sitioWeb,
        direccion: data.direccion,
        ciudad: data.ciudad,
        provincia: data.provincia,
        departamento: data.departamento,
        distrito: data.distrito,
        pais: data.pais || 'PE',
        estadoContribuyente: data.estadoContribuyente,
        condicionContribuyente: data.condicionContribuyente,
        ubigeo: data.ubigeo,
        notas: data.notas,
        isActive: data.isActive !== undefined ? data.isActive : true,
        motivoInactivo: data.motivoInactivo,
        creadoPor: data.creadoPor,
        contactos: data.contactos
          ? {
              create: data.contactos.map((c) => ({
                nombre: c.nombre,
                cargo: c.cargo,
                dni: c.dni,
                email: c.email,
                telefono: c.telefono,
                telefonoMovil: c.telefonoMovil,
                esPrincipal: c.esPrincipal || false,
              })),
            }
          : undefined,
      },
      include: {
        contactos: true,
      },
    });
  }

  async findAll(empresaId: string, query: QueryClienteEmpresaDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const includeInactive = query.includeInactive === 'true';

    const where: any = {
      empresaId,
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
    };

    if (query.search) {
      where.OR = [
        { razonSocial: { contains: query.search, mode: 'insensitive' } },
        { nombreComercial: { contains: query.search, mode: 'insensitive' } },
        { numeroDocumento: { contains: query.search, mode: 'insensitive' } },
        { codigo: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.clienteEmpresa.findMany({
        where,
        skip,
        take: limit,
        orderBy: { razonSocial: 'asc' },
        include: {
          contactos: true,
          _count: { select: { ordenesServicio: true } },
        },
      }),
      this.prisma.clienteEmpresa.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      pageSize: limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  async findOne(id: string, empresaId: string) {
    const clienteEmpresa = await this.prisma.clienteEmpresa.findFirst({
      where: { id, empresaId, deletedAt: null },
      include: {
        contactos: true,
        _count: { select: { ordenesServicio: true } },
      },
    });

    if (!clienteEmpresa) {
      throw new NotFoundException('Cliente empresa no encontrado');
    }

    return clienteEmpresa;
  }

  async update(id: string, empresaId: string, data: UpdateClienteEmpresaDto) {
    const clienteEmpresa = await this.findOne(id, empresaId);

    // Verificar duplicado si cambia número de documento
    if (
      data.numeroDocumento &&
      data.numeroDocumento !== clienteEmpresa.numeroDocumento
    ) {
      const existente = await this.prisma.clienteEmpresa.findUnique({
        where: {
          empresaId_numeroDocumento: {
            empresaId,
            numeroDocumento: data.numeroDocumento,
          },
        },
      });

      if (existente) {
        throw new ConflictException(
          `Ya existe un cliente empresa con el documento ${data.numeroDocumento}`,
        );
      }
    }

    return this.prisma.clienteEmpresa.update({
      where: { id },
      data: {
        razonSocial: data.razonSocial,
        nombreComercial: data.nombreComercial,
        tipoDocumento: data.tipoDocumento,
        numeroDocumento: data.numeroDocumento,
        email: data.email,
        telefono: data.telefono,
        telefonoAlternativo: data.telefonoAlternativo,
        sitioWeb: data.sitioWeb,
        direccion: data.direccion,
        ciudad: data.ciudad,
        provincia: data.provincia,
        departamento: data.departamento,
        distrito: data.distrito,
        pais: data.pais,
        estadoContribuyente: data.estadoContribuyente,
        condicionContribuyente: data.condicionContribuyente,
        ubigeo: data.ubigeo,
        notas: data.notas,
        isActive: data.isActive,
        motivoInactivo: data.motivoInactivo,
        actualizadoPor: data.actualizadoPor,
      },
      include: {
        contactos: true,
      },
    });
  }

  async remove(id: string, empresaId: string, motivo?: string) {
    await this.findOne(id, empresaId);

    return this.prisma.$transaction(async (tx) => {
      // Verificar que no tenga órdenes activas dentro de la transacción
      const ordenesActivas = await tx.ordenServicio.count({
        where: {
          clienteEmpresaId: id,
          empresaId,
          estado: { notIn: ['CANCELADO', 'FINALIZADO'] },
        },
      });

      if (ordenesActivas > 0) {
        throw new BadRequestException(
          `No se puede eliminar: tiene ${ordenesActivas} orden(es) de servicio activa(s)`,
        );
      }

      return tx.clienteEmpresa.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          motivoInactivo: motivo || 'Eliminado por el usuario',
        },
      });
    });
  }

  // ─── Contactos ───

  async addContacto(
    clienteEmpresaId: string,
    empresaId: string,
    data: CreateClienteEmpresaContactoDto,
  ) {
    await this.findOne(clienteEmpresaId, empresaId);

    return this.prisma.clienteEmpresaContacto.create({
      data: {
        clienteEmpresaId,
        nombre: data.nombre,
        cargo: data.cargo,
        dni: data.dni,
        email: data.email,
        telefono: data.telefono,
        telefonoMovil: data.telefonoMovil,
        esPrincipal: data.esPrincipal || false,
      },
    });
  }

  async removeContacto(
    clienteEmpresaId: string,
    contactoId: string,
    empresaId: string,
  ) {
    await this.findOne(clienteEmpresaId, empresaId);

    const contacto = await this.prisma.clienteEmpresaContacto.findFirst({
      where: { id: contactoId, clienteEmpresaId },
    });

    if (!contacto) {
      throw new NotFoundException('Contacto no encontrado');
    }

    // Validar que no tenga órdenes activas referenciando este contacto
    const activeOrdenes = await this.prisma.ordenServicio.count({
      where: {
        contactoClienteEmpresaId: contactoId,
        estado: { notIn: ['CANCELADO', 'FINALIZADO', 'ENTREGADO'] },
      },
    });

    if (activeOrdenes > 0) {
      throw new BadRequestException(
        `No se puede eliminar: tiene ${activeOrdenes} orden(es) de servicio activa(s) referenciando este contacto`,
      );
    }

    return this.prisma.clienteEmpresaContacto.delete({
      where: { id: contactoId },
    });
  }

  async updateContacto(
    clienteEmpresaId: string,
    contactoId: string,
    empresaId: string,
    data: Partial<CreateClienteEmpresaContactoDto>,
  ) {
    await this.findOne(clienteEmpresaId, empresaId);

    const contacto = await this.prisma.clienteEmpresaContacto.findFirst({
      where: { id: contactoId, clienteEmpresaId },
    });

    if (!contacto) {
      throw new NotFoundException('Contacto no encontrado');
    }

    const updateData: Record<string, any> = {};
    if (data.nombre !== undefined) updateData.nombre = data.nombre;
    if (data.cargo !== undefined) updateData.cargo = data.cargo;
    if (data.dni !== undefined) updateData.dni = data.dni;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.telefono !== undefined) updateData.telefono = data.telefono;
    if (data.telefonoMovil !== undefined) updateData.telefonoMovil = data.telefonoMovil;
    if (data.esPrincipal !== undefined) updateData.esPrincipal = data.esPrincipal;

    return this.prisma.clienteEmpresaContacto.update({
      where: { id: contactoId },
      data: updateData,
    });
  }
}
