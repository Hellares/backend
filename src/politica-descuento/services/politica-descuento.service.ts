import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePoliticaDescuentoDto,
  UpdatePoliticaDescuentoDto,
  AsignarUsuariosDto,
  AgregarFamiliarDto,
  AsignarProductosDto,
  AsignarCategoriasDto,
  QueryPoliticaDescuentoDto,
  CalcularDescuentoDto,
  TipoCalculoDescuento,
} from '../dto';

@Injectable()
export class PoliticaDescuentoService {
  constructor(private prisma: PrismaService) {}

  // =========================================
  // CRUD DE POLÍTICAS
  // =========================================

  async crear(dto: CreatePoliticaDescuentoDto, empresaId: string) {
    return this.prisma.politicaDescuento.create({
      data: {
        ...dto,
        empresaId,
        fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : null,
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
      },
      include: {
        usuariosConDescuento: {
          include: {
            usuario: {
              include: {
                persona: true,
              },
            },
          },
        },
        productosAplicables: {
          include: {
            producto: true,
          },
        },
        categoriasAplicables: {
          include: {
            categoria: true,
          },
        },
      },
    });
  }

  async obtenerTodas(query: QueryPoliticaDescuentoDto, empresaId: string) {
    const { tipoDescuento, isActive, page = 1, limit = 20 } = query;

    const where: any = {
      empresaId,
      deletedAt: null,
    };

    if (tipoDescuento) {
      where.tipoDescuento = tipoDescuento;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [politicas, total] = await Promise.all([
      this.prisma.politicaDescuento.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ prioridad: 'desc' }, { creadoEn: 'desc' }],
        include: {
          usuariosConDescuento: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              usuarioId: true,
              esFamiliar: true,
            },
          },
          productosAplicables: {
            select: {
              id: true,
              productoId: true,
            },
          },
          categoriasAplicables: {
            select: {
              id: true,
              categoriaId: true,
            },
          },
          _count: {
            select: {
              usuariosConDescuento: true,
              usosHistorial: true,
            },
          },
        },
      }),
      this.prisma.politicaDescuento.count({ where }),
    ]);

    return {
      data: politicas,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async obtenerPorId(id: string, empresaId: string) {
    const politica = await this.prisma.politicaDescuento.findFirst({
      where: {
        id,
        empresaId,
        deletedAt: null,
      },
      include: {
        usuariosConDescuento: {
          where: { isActive: true, deletedAt: null },
          include: {
            usuario: {
              include: {
                persona: true,
              },
            },
            trabajador: {
              include: {
                persona: true,
              },
            },
          },
        },
        productosAplicables: {
          include: {
            producto: {
              select: {
                id: true,
                nombre: true,
                // ❌ precio - DEPRECATED: Precio ahora en ProductoStock por sede
                sku: true,
              },
            },
          },
        },
        categoriasAplicables: {
          include: {
            categoria: {
              select: {
                id: true,
                nombrePersonalizado: true,
                nombreLocal: true,
              },
            },
          },
        },
        _count: {
          select: {
            usuariosConDescuento: true,
            usosHistorial: true,
          },
        },
      },
    });

    if (!politica) {
      throw new NotFoundException(
        `Política de descuento con ID ${id} no encontrada`,
      );
    }

    return politica;
  }

  async actualizar(
    id: string,
    dto: UpdatePoliticaDescuentoDto,
    empresaId: string,
  ) {
    const politica = await this.obtenerPorId(id, empresaId);

    return this.prisma.politicaDescuento.update({
      where: { id: politica.id },
      data: {
        ...dto,
        fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : undefined,
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : undefined,
      },
      include: {
        usuariosConDescuento: {
          include: {
            usuario: {
              include: {
                persona: true,
              },
            },
          },
        },
        productosAplicables: {
          include: {
            producto: true,
          },
        },
        categoriasAplicables: {
          include: {
            categoria: true,
          },
        },
      },
    });
  }

  async eliminar(id: string, empresaId: string) {
    const politica = await this.obtenerPorId(id, empresaId);

    return this.prisma.politicaDescuento.update({
      where: { id: politica.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }

  // =========================================
  // ASIGNACIÓN DE USUARIOS
  // =========================================

  async asignarUsuarios(
    politicaId: string,
    dto: AsignarUsuariosDto,
    empresaId: string,
    aprobadoPor: string,
  ) {
    const politica = await this.obtenerPorId(politicaId, empresaId);

    // Verificar que los usuarios existan y pertenezcan a la empresa
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        id: { in: dto.usuariosIds },
        empresas: {
          some: {
            empresaId,
            isActive: true,
          },
        },
      },
    });

    if (usuarios.length !== dto.usuariosIds.length) {
      throw new BadRequestException(
        'Algunos usuarios no existen o no pertenecen a la empresa',
      );
    }

    // Crear asignaciones
    const asignaciones = await Promise.all(
      dto.usuariosIds.map((usuarioId) =>
        this.prisma.usuarioDescuento.upsert({
          where: {
            usuarioId_politicaId: {
              usuarioId,
              politicaId: politica.id,
            },
          },
          create: {
            usuarioId,
            politicaId: politica.id,
            empresaId,
            esFamiliar: false,
            limiteMensualUsos: dto.limiteMensualUsos,
            aprobadoPor,
            fechaAprobacion: new Date(),
          },
          update: {
            isActive: true,
            deletedAt: null,
            limiteMensualUsos: dto.limiteMensualUsos,
          },
          include: {
            usuario: {
              include: {
                persona: true,
              },
            },
          },
        }),
      ),
    );

    return asignaciones;
  }

  async obtenerUsuariosAsignados(politicaId: string, empresaId: string) {
    const politica = await this.obtenerPorId(politicaId, empresaId);

    const usuarios = await this.prisma.usuarioDescuento.findMany({
      where: {
        politicaId: politica.id,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        usuarioId: true,
      },
    });

    return usuarios;
  }

  async removerUsuario(
    politicaId: string,
    usuarioId: string,
    empresaId: string,
  ) {
    const politica = await this.obtenerPorId(politicaId, empresaId);

    const asignacion = await this.prisma.usuarioDescuento.findFirst({
      where: {
        politicaId: politica.id,
        usuarioId,
        empresaId,
      },
    });

    if (!asignacion) {
      throw new NotFoundException('Asignación no encontrada');
    }

    return this.prisma.usuarioDescuento.update({
      where: { id: asignacion.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }

  // =========================================
  // GESTIÓN DE FAMILIARES
  // =========================================

  async agregarFamiliar(
    trabajadorId: string,
    dto: AgregarFamiliarDto,
    empresaId: string,
    aprobadoPor: string,
  ) {
    // Verificar que el trabajador exista y tenga descuento asignado
    const trabajadorDescuento = await this.prisma.usuarioDescuento.findFirst({
      where: {
        usuarioId: trabajadorId,
        empresaId,
        esFamiliar: false,
        isActive: true,
        deletedAt: null,
      },
      include: {
        politica: true,
      },
    });

    if (!trabajadorDescuento) {
      throw new NotFoundException(
        'El trabajador no tiene descuentos asignados',
      );
    }

    // Verificar que la política sea para familiares
    const politicaFamiliares = await this.prisma.politicaDescuento.findFirst({
      where: {
        id: dto.politicaId,
        empresaId,
        deletedAt: null,
        isActive: true,
      },
    });

    if (!politicaFamiliares) {
      throw new NotFoundException('Política de descuento no encontrada');
    }

    // Verificar límite de familiares
    if (politicaFamiliares.maxFamiliaresPorTrabajador) {
      const familiaresActuales = await this.prisma.usuarioDescuento.count({
        where: {
          trabajadorId,
          esFamiliar: true,
          isActive: true,
          deletedAt: null,
        },
      });

      if (
        familiaresActuales >= politicaFamiliares.maxFamiliaresPorTrabajador
      ) {
        throw new BadRequestException(
          `El trabajador ha alcanzado el límite máximo de ${politicaFamiliares.maxFamiliaresPorTrabajador} familiares`,
        );
      }
    }

    // Verificar que el familiar exista
    const familiar = await this.prisma.usuario.findUnique({
      where: { id: dto.familiarId },
      include: { persona: true },
    });

    if (!familiar) {
      throw new NotFoundException('Usuario familiar no encontrado');
    }

    // Crear asignación de familiar
    return this.prisma.usuarioDescuento.create({
      data: {
        usuarioId: dto.familiarId,
        politicaId: dto.politicaId,
        empresaId,
        esFamiliar: true,
        trabajadorId,
        parentesco: dto.parentesco,
        documentoVerificacion: dto.documentoVerificacion,
        limiteMensualUsos: dto.limiteMensualUsos,
        aprobadoPor,
        fechaAprobacion: new Date(),
      },
      include: {
        usuario: {
          include: {
            persona: true,
          },
        },
        trabajador: {
          include: {
            persona: true,
          },
        },
        politica: true,
      },
    });
  }

  async obtenerFamiliares(trabajadorId: string, empresaId: string) {
    return this.prisma.usuarioDescuento.findMany({
      where: {
        trabajadorId,
        empresaId,
        esFamiliar: true,
        isActive: true,
        deletedAt: null,
      },
      include: {
        usuario: {
          include: {
            persona: true,
          },
        },
        politica: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async removerFamiliar(
    trabajadorId: string,
    familiarId: string,
    empresaId: string,
  ) {
    const asignacion = await this.prisma.usuarioDescuento.findFirst({
      where: {
        trabajadorId,
        usuarioId: familiarId,
        empresaId,
        esFamiliar: true,
      },
    });

    if (!asignacion) {
      throw new NotFoundException('Familiar no encontrado');
    }

    return this.prisma.usuarioDescuento.update({
      where: { id: asignacion.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }

  // =========================================
  // PRODUCTOS Y CATEGORÍAS
  // =========================================

  async asignarProductos(
    politicaId: string,
    dto: AsignarProductosDto,
    empresaId: string,
  ) {
    const politica = await this.obtenerPorId(politicaId, empresaId);

    // Verificar que los productos existan
    const productos = await this.prisma.producto.findMany({
      where: {
        id: { in: dto.productos.map((p) => p.productoId) },
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (productos.length !== dto.productos.length) {
      throw new BadRequestException('Algunos productos no existen');
    }

    // Crear asignaciones
    const asignaciones = await Promise.all(
      dto.productos.map((item) =>
        this.prisma.politicaDescuentoProducto.upsert({
          where: {
            politicaId_productoId: {
              politicaId: politica.id,
              productoId: item.productoId,
            },
          },
          create: {
            politicaId: politica.id,
            productoId: item.productoId,
            descuentoOverride: item.descuentoOverride,
          },
          update: {
            descuentoOverride: item.descuentoOverride,
          },
          include: {
            producto: true,
          },
        }),
      ),
    );

    return asignaciones;
  }

  async asignarCategorias(
    politicaId: string,
    dto: AsignarCategoriasDto,
    empresaId: string,
  ) {
    const politica = await this.obtenerPorId(politicaId, empresaId);

    // Verificar que las categorías existan
    const categorias = await this.prisma.empresaCategoria.findMany({
      where: {
        id: { in: dto.categorias.map((c) => c.categoriaId) },
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (categorias.length !== dto.categorias.length) {
      throw new BadRequestException('Algunas categorías no existen');
    }

    // Crear asignaciones
    const asignaciones = await Promise.all(
      dto.categorias.map((item) =>
        this.prisma.politicaDescuentoCategoria.upsert({
          where: {
            politicaId_categoriaId: {
              politicaId: politica.id,
              categoriaId: item.categoriaId,
            },
          },
          create: {
            politicaId: politica.id,
            categoriaId: item.categoriaId,
            descuentoOverride: item.descuentoOverride,
          },
          update: {
            descuentoOverride: item.descuentoOverride,
          },
          include: {
            categoria: true,
          },
        }),
      ),
    );

    return asignaciones;
  }

  // =========================================
  // CÁLCULO DE DESCUENTOS
  // =========================================

  async calcularDescuento(dto: CalcularDescuentoDto, empresaId: string) {
    // Determinar el precio sobre el cual se calculará el descuento
    // Estrategia:
    // - Si aplicarSobrePromocion = true y existe precioPromocion: usar precioPromocion (apilar descuentos)
    // - Si aplicarSobrePromocion = false: calcular con precioBase y luego comparar con precioPromocion
    const precioParaCalculo =
      dto.aplicarSobrePromocion && dto.precioPromocion
        ? dto.precioPromocion
        : dto.precioBase;

    // Obtener descuentos aplicables para el usuario
    const descuentosUsuario = await this.prisma.usuarioDescuento.findMany({
      where: {
        usuarioId: dto.usuarioId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        politica: {
          include: {
            productosAplicables: true,
            categoriasAplicables: true,
          },
        },
      },
    });

    if (descuentosUsuario.length === 0) {
      // Sin descuentos: retornar el mejor precio disponible
      const precioFinal = dto.precioPromocion || dto.precioBase;
      return {
        tieneDescuento: false,
        precioOriginal: dto.precioBase,
        precioPromocion: dto.precioPromocion,
        precioFinal: precioFinal,
        descuentoAplicado: 0,
        cantidad: dto.cantidad,
        subtotal: precioFinal * dto.cantidad,
      };
    }

    // Obtener el producto para verificar su categoría
    const producto = await this.prisma.producto.findUnique({
      where: { id: dto.productoId },
      select: { empresaCategoriaId: true },
    });

    let mejorDescuento: any = null;
    let menorPrecio = precioParaCalculo;

    for (const descuentoUsuario of descuentosUsuario) {
      const politica = descuentoUsuario.politica;

      // Verificar vigencia
      if (politica.fechaInicio && new Date() < politica.fechaInicio) {
        continue;
      }
      if (politica.fechaFin && new Date() > politica.fechaFin) {
        continue;
      }

      // Verificar si aplica a este producto
      const aplicaATodos = politica.aplicarATodos;
      const aplicaAProducto = politica.productosAplicables.some(
        (p) => p.productoId === dto.productoId,
      );
      const aplicaACategoria =
        producto?.empresaCategoriaId &&
        politica.categoriasAplicables.some(
          (c) => c.categoriaId === producto.empresaCategoriaId,
        );

      if (!aplicaATodos && !aplicaAProducto && !aplicaACategoria) {
        continue;
      }

      // Calcular monto de compra total
      const montoCompra = precioParaCalculo * dto.cantidad;

      // Verificar monto mínimo
      if (politica.montoMinCompra && montoCompra < politica.montoMinCompra.toNumber()) {
        continue;
      }

      // Verificar límite de usos
      if (politica.cantidadMaxUsos) {
        const usosActuales = await this.prisma.descuentoUsoHistorial.count({
          where: {
            usuarioId: dto.usuarioId,
            politicaId: politica.id,
          },
        });

        if (usosActuales >= politica.cantidadMaxUsos) {
          continue;
        }
      }

      // Calcular descuento
      let valorDescuento = politica.valorDescuento.toNumber();

      // Verificar si hay override
      const productoOverride = politica.productosAplicables.find(
        (p) => p.productoId === dto.productoId && p.descuentoOverride,
      );
      const categoriaOverride =
        producto?.empresaCategoriaId &&
        politica.categoriasAplicables.find(
          (c) =>
            c.categoriaId === producto.empresaCategoriaId &&
            c.descuentoOverride,
        );

      if (productoOverride?.descuentoOverride) {
        valorDescuento = productoOverride.descuentoOverride.toNumber();
      } else if (categoriaOverride?.descuentoOverride) {
        valorDescuento = categoriaOverride.descuentoOverride.toNumber();
      }

      let descuentoCalculado = 0;
      if (politica.tipoCalculo === TipoCalculoDescuento.PORCENTAJE) {
        descuentoCalculado = precioParaCalculo * (valorDescuento / 100);
      } else {
        descuentoCalculado = valorDescuento;
      }

      // Aplicar límite de descuento máximo
      if (
        politica.descuentoMaximo &&
        descuentoCalculado > politica.descuentoMaximo.toNumber()
      ) {
        descuentoCalculado = politica.descuentoMaximo.toNumber();
      }

      const precioConDescuento = Math.max(
        precioParaCalculo - descuentoCalculado,
        0,
      );

      // Guardar el mejor descuento
      if (precioConDescuento < menorPrecio) {
        menorPrecio = precioConDescuento;
        mejorDescuento = {
          politica,
          descuentoAplicado: descuentoCalculado,
          valorDescuento,
        };
      }
    }

    // Determinar el precio final según la estrategia
    let precioFinal = menorPrecio;
    let descuentoTotal = precioParaCalculo - precioFinal;
    let usandoPromocion = false;

    // Si NO se apila y hay precio promocional, comparar cuál es mejor
    if (!dto.aplicarSobrePromocion && dto.precioPromocion) {
      if (dto.precioPromocion < precioFinal) {
        // La promoción es mejor que el descuento
        precioFinal = dto.precioPromocion;
        descuentoTotal = dto.precioBase - precioFinal;
        usandoPromocion = true;
        mejorDescuento = null; // No se usa política, se usa promoción
      }
    }

    return {
      tieneDescuento: mejorDescuento !== null || usandoPromocion,
      precioOriginal: dto.precioBase,
      precioPromocion: dto.precioPromocion,
      precioFinal,
      descuentoAplicado: descuentoTotal,
      cantidad: dto.cantidad,
      subtotal: precioFinal * dto.cantidad,
      politicaUsada: mejorDescuento
        ? {
            id: mejorDescuento.politica.id,
            nombre: mejorDescuento.politica.nombre,
            tipoDescuento: mejorDescuento.politica.tipoDescuento,
            tipoCalculo: mejorDescuento.politica.tipoCalculo,
            valorDescuento: mejorDescuento.valorDescuento,
          }
        : null,
      usandoPromocion,
    };
  }

  // =========================================
  // HISTORIAL Y REPORTES
  // =========================================

  async obtenerHistorialUso(politicaId: string, empresaId: string) {
    await this.obtenerPorId(politicaId, empresaId);

    return this.prisma.descuentoUsoHistorial.findMany({
      where: {
        politicaId,
        empresaId,
      },
      include: {
        usuario: {
          include: {
            persona: true,
          },
        },
        producto: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
          },
        },
        cajero: {
          include: {
            persona: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }
}
