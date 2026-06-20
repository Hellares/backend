import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
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
    private readonly consultasExternas: ConsultasExternasService,
    private readonly realtime: RealtimeInvalidationService,
  ) {}

  /// Push CLIENTE_EMPRESA_CAMBIADO (fire-and-forget). Per-empresa: el
  /// ClienteEmpresa no se comparte entre tenants, sin fan-out.
  private notificarCambio(empresaId: string, clienteEmpresaId?: string) {
    this.realtime.notifyClienteEmpresaCambiado({ empresaId, clienteEmpresaId });
  }

  /**
   * Registra/vincula un PROVEEDOR como cliente (mismo tercero: le compramos Y
   * le vendemos), para la cuenta corriente unificada. Idempotente:
   *  - si el proveedor ya está vinculado a un cliente → lo devuelve;
   *  - si ya existe un cliente con el mismo RUC → lo vincula (no duplica);
   *  - si no → crea uno copiando los datos del proveedor.
   */
  async vincularDesdeProveedor(
    empresaId: string,
    proveedorId: string,
    usuarioId: string,
  ) {
    const prov = await this.prisma.proveedor.findFirst({
      where: { id: proveedorId, empresaId },
    });
    if (!prov) throw new NotFoundException('Proveedor no encontrado');

    const yaVinculado = await this.prisma.clienteEmpresa.findFirst({
      where: { empresaId, proveedorId },
    });
    if (yaVinculado) return { clienteEmpresa: yaVinculado, accion: 'YA_VINCULADO' };

    // Mismo RUC ya cargado como cliente → vincular (la unique [empresaId,
    // numeroDocumento] impide duplicar).
    const existente = await this.prisma.clienteEmpresa.findFirst({
      where: { empresaId, numeroDocumento: prov.numeroDocumento },
    });
    if (existente) {
      const actualizado = await this.prisma.clienteEmpresa.update({
        where: { id: existente.id },
        data: { proveedorId, deletedAt: null, isActive: true, actualizadoPor: usuarioId },
      });
      this.notificarCambio(empresaId, actualizado.id);
      return { clienteEmpresa: actualizado, accion: 'VINCULADO_EXISTENTE' };
    }

    const { codigoClienteEmpresa: codigo } =
      await this.configuracionCodigosService.generarCodigoClienteEmpresa(empresaId);
    const creado = await this.prisma.clienteEmpresa.create({
      data: {
        empresaId,
        codigo,
        razonSocial: prov.nombre,
        nombreComercial: prov.nombreComercial,
        tipoDocumento: prov.tipoDocumento,
        numeroDocumento: prov.numeroDocumento,
        email: prov.email,
        telefono: prov.telefono,
        telefonoAlternativo: prov.telefonoAlternativo,
        sitioWeb: prov.sitioWeb,
        direccion: prov.direccion,
        ciudad: prov.ciudad,
        provincia: prov.provincia,
        departamento: prov.departamento,
        pais: prov.pais || 'PE',
        notas: prov.notas,
        proveedorId,
        creadoPor: usuarioId,
      },
    });
    this.notificarCambio(empresaId, creado.id);
    return { clienteEmpresa: creado, accion: 'CREADO' };
  }

  /**
   * Busca o crea un ClienteEmpresa por RUC usando consulta SUNAT.
   *
   * Flujo:
   *  1) Valida RUC (11 dígitos).
   *  2) Llama `consultarRuc` (con caché interna) que devuelve datos SUNAT.
   *  3) Upsert por (empresaId, numeroDocumento): si existe lo reactiva si
   *     estaba soft-deleted; si no, lo crea con código auto-generado.
   *
   * Idempotente. Usado por Venta Rápida cuando el cliente brinda RUC.
   */
  async getOrCreateByRuc(
    empresaId: string,
    ruc: string,
    creadoPor: string,
  ): Promise<{
    clienteEmpresaId: string;
    ruc: string;
    razonSocial: string;
    nombreComercial?: string;
    direccion?: string;
    estadoContribuyente?: string;
    condicionContribuyente?: string;
  }> {
    const rucLimpio = (ruc ?? '').trim();
    if (!/^\d{11}$/.test(rucLimpio)) {
      throw new BadRequestException('El RUC debe tener exactamente 11 dígitos numéricos');
    }

    // 1) Resolver datos SUNAT
    const datos = await this.consultasExternas.consultarRuc(rucLimpio);

    // 2) Upsert ClienteEmpresa
    const existente = await this.prisma.clienteEmpresa.findUnique({
      where: {
        empresaId_numeroDocumento: { empresaId, numeroDocumento: rucLimpio },
      },
    });

    let cliente = existente;
    let huboCambio = false;
    if (!cliente) {
      huboCambio = true;
      const { codigoClienteEmpresa: codigo } =
        await this.configuracionCodigosService.generarCodigoClienteEmpresa(empresaId);
      cliente = await this.prisma.clienteEmpresa.create({
        data: {
          empresaId,
          codigo,
          razonSocial: datos.razonSocial,
          tipoDocumento: 'RUC',
          numeroDocumento: rucLimpio,
          direccion: datos.direccion || null,
          departamento: datos.departamento || null,
          provincia: datos.provincia || null,
          distrito: datos.distrito || null,
          ubigeo: datos.ubigeo || null,
          estadoContribuyente: datos.estado || null,
          condicionContribuyente: datos.condicion || null,
          pais: 'PE',
          isActive: true,
          creadoPor,
        },
      });
    } else if (cliente.deletedAt !== null || !cliente.isActive) {
      huboCambio = true;
      cliente = await this.prisma.clienteEmpresa.update({
        where: { id: cliente.id },
        data: { deletedAt: null, isActive: true, actualizadoPor: creadoPor },
      });
    }

    // Solo si creó/reactivó — VR consulta por RUC en cada lookup.
    if (huboCambio) this.notificarCambio(empresaId, cliente.id);

    return {
      clienteEmpresaId: cliente.id,
      ruc: cliente.numeroDocumento,
      razonSocial: cliente.razonSocial,
      nombreComercial: cliente.nombreComercial ?? undefined,
      direccion: cliente.direccion ?? undefined,
      estadoContribuyente: cliente.estadoContribuyente ?? undefined,
      condicionContribuyente: cliente.condicionContribuyente ?? undefined,
    };
  }

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

    const created = await this.prisma.clienteEmpresa.create({
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

    // Hint de vinculación: verificar si existe una Empresa tenant con el mismo RUC
    let empresaVinculable = null;
    if ((data.tipoDocumento ?? 'RUC') === 'RUC') {
      empresaVinculable = await this.prisma.empresa.findFirst({
        where: {
          ruc: created.numeroDocumento,
          id: { not: data.empresaId },
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, nombre: true, logo: true, rubro: true },
      });
    }

    this.notificarCambio(data.empresaId, created.id);

    return { ...created, empresaVinculable };
  }

  /**
   * Delta-sync del catálogo de clientes empresa B2B (patrón /clientes/sync).
   * A diferencia de Personas no hay OR a una entidad compartida — el
   * ClienteEmpresa es per-tenant — pero las mutaciones de CONTACTOS
   * bumpean el actualizadoEn del padre para entrar en los deltas.
   */
  async syncDeltas(empresaId: string, lastSyncRaw?: string) {
    const MAX_DELTA = 500;
    const MAX_FULL = 5000;
    const ahora = new Date();

    let since: Date | null = null;
    if (lastSyncRaw) {
      const parsed = new Date(lastSyncRaw);
      const valida = !Number.isNaN(parsed.getTime());
      const muyViejo =
        valida && ahora.getTime() - parsed.getTime() > 7 * 24 * 60 * 60 * 1000;
      if (valida && !muyViejo) since = parsed;
    }

    const whereBase = { empresaId, deletedAt: null };
    const include = { contactos: true };

    let fullSync = since === null;
    let rows;

    if (!fullSync) {
      rows = await this.prisma.clienteEmpresa.findMany({
        where: { ...whereBase, actualizadoEn: { gt: since! } },
        include,
        take: MAX_DELTA + 1,
      });
      if (rows.length > MAX_DELTA) fullSync = true;
    }

    if (fullSync) {
      rows = await this.prisma.clienteEmpresa.findMany({
        where: whereBase,
        include,
        orderBy: { razonSocial: 'asc' },
        take: MAX_FULL,
      });
    }

    const deleted = fullSync
      ? []
      : (
          await this.prisma.clienteEmpresa.findMany({
            where: { empresaId, deletedAt: { gt: since! } },
            select: { id: true },
          })
        ).map((r) => r.id);

    return {
      updated: rows!,
      deleted,
      fullSync,
      serverTime: ahora.toISOString(),
    };
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

    const actualizado = await this.prisma.clienteEmpresa.update({
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

    this.notificarCambio(empresaId, id);
    return actualizado;
  }

  async remove(id: string, empresaId: string, motivo?: string) {
    await this.findOne(id, empresaId);

    const eliminado = await this.prisma.$transaction(async (tx) => {
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

    this.notificarCambio(empresaId, id);
    return eliminado;
  }

  // ─── Contactos ───

  async addContacto(
    clienteEmpresaId: string,
    empresaId: string,
    data: CreateClienteEmpresaContactoDto,
  ) {
    await this.findOne(clienteEmpresaId, empresaId);

    // Bump del padre en la MISMA tx: el delta-sync filtra por
    // ClienteEmpresa.actualizadoEn — sin esto, los cambios de contactos
    // serían invisibles para el catálogo local.
    const [contacto] = await this.prisma.$transaction([
      this.prisma.clienteEmpresaContacto.create({
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
      }),
      this.prisma.clienteEmpresa.update({
        where: { id: clienteEmpresaId },
        data: { actualizadoEn: new Date() },
      }),
    ]);

    this.notificarCambio(empresaId, clienteEmpresaId);
    return contacto;
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

    const [eliminado] = await this.prisma.$transaction([
      this.prisma.clienteEmpresaContacto.delete({
        where: { id: contactoId },
      }),
      // Bump del padre para el delta-sync (ver addContacto).
      this.prisma.clienteEmpresa.update({
        where: { id: clienteEmpresaId },
        data: { actualizadoEn: new Date() },
      }),
    ]);

    this.notificarCambio(empresaId, clienteEmpresaId);
    return eliminado;
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

    const [actualizado] = await this.prisma.$transaction([
      this.prisma.clienteEmpresaContacto.update({
        where: { id: contactoId },
        data: updateData,
      }),
      // Bump del padre para el delta-sync (ver addContacto).
      this.prisma.clienteEmpresa.update({
        where: { id: clienteEmpresaId },
        data: { actualizadoEn: new Date() },
      }),
    ]);

    this.notificarCambio(empresaId, clienteEmpresaId);
    return actualizado;
  }
}
