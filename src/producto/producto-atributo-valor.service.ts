import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { SetProductoAtributosDto, AtributoValorDto } from './dto/create-producto-atributo-valor.dto';
import { AtributoTipo } from '@prisma/client';

export interface AtributoValorResponse {
  id: string;
  productoId?: string;
  varianteId?: string;
  atributoId: string;
  valor: string;
  // Información del atributo (plantilla)
  atributo: {
    nombre: string;
    clave: string;
    tipo: AtributoTipo;
    unidad?: string;
  };
}

@Injectable()
export class ProductoAtributoValorService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoAtributoValorService.name);
  }

  /**
   * Asignar o actualizar atributos de un producto
   */
  async setProductoAtributos(
    empresaId: string,
    productoId: string,
    dto: SetProductoAtributosDto,
  ): Promise<AtributoValorResponse[]> {
    this.logger.info('Setting producto attributes', { productoId, dto });

    // Verificar que el producto existe y pertenece a la empresa
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    // Validar que todos los atributos existen y pertenecen a la empresa
    await this.validateAtributos(empresaId, dto.atributos);

    // Usar transacción para asegurar atomicidad
    return await this.prisma.$transaction(async (tx) => {
      // Eliminar todos los valores existentes del producto
      await tx.productoAtributoValor.deleteMany({
        where: { productoId },
      });

      // Crear los nuevos valores
      const valoresCreados = await Promise.all(
        dto.atributos.map((atributo) =>
          tx.productoAtributoValor.create({
            data: {
              productoId,
              atributoId: atributo.atributoId,
              valor: atributo.valor,
            },
            include: {
              atributo: {
                select: {
                  nombre: true,
                  clave: true,
                  tipo: true,
                  unidad: true,
                },
              },
            },
          }),
        ),
      );

      return valoresCreados.map((v) => this.mapToResponse(v));
    });
  }

  /**
   * Asignar o actualizar atributos de una variante
   */
  async setVarianteAtributos(
    empresaId: string,
    varianteId: string,
    dto: SetProductoAtributosDto,
  ): Promise<AtributoValorResponse[]> {
    this.logger.info('Setting variante attributes', { varianteId, dto });

    // Verificar que la variante existe y pertenece a la empresa
    const variante = await this.prisma.productoVariante.findFirst({
      where: { id: varianteId, empresaId },
    });

    if (!variante) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    // Validar que todos los atributos existen y pertenecen a la empresa
    await this.validateAtributos(empresaId, dto.atributos);

    // Usar transacción para asegurar atomicidad
    return await this.prisma.$transaction(async (tx) => {
      // Eliminar todos los valores existentes de la variante
      await tx.productoAtributoValor.deleteMany({
        where: { varianteId },
      });

      // Crear los nuevos valores
      const valoresCreados = await Promise.all(
        dto.atributos.map((atributo) =>
          tx.productoAtributoValor.create({
            data: {
              varianteId,
              atributoId: atributo.atributoId,
              valor: atributo.valor,
            },
            include: {
              atributo: {
                select: {
                  nombre: true,
                  clave: true,
                  tipo: true,
                  unidad: true,
                },
              },
            },
          }),
        ),
      );

      return valoresCreados.map((v) => this.mapToResponse(v));
    });
  }

  /**
   * Obtener atributos de un producto
   */
  async getProductoAtributos(
    empresaId: string,
    productoId: string,
  ): Promise<AtributoValorResponse[]> {
    this.logger.debug('Getting producto attributes', { productoId });

    // Verificar que el producto existe
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    const valores = await this.prisma.productoAtributoValor.findMany({
      where: { productoId },
      include: {
        atributo: {
          select: {
            nombre: true,
            clave: true,
            tipo: true,
            unidad: true,
          },
        },
      },
    });

    return valores.map((v) => this.mapToResponse(v));
  }

  /**
   * Obtener atributos de una variante
   */
  async getVarianteAtributos(
    empresaId: string,
    varianteId: string,
  ): Promise<AtributoValorResponse[]> {
    this.logger.debug('Getting variante attributes', { varianteId });

    // Verificar que la variante existe
    const variante = await this.prisma.productoVariante.findFirst({
      where: { id: varianteId, empresaId },
    });

    if (!variante) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    const valores = await this.prisma.productoAtributoValor.findMany({
      where: { varianteId },
      include: {
        atributo: {
          select: {
            nombre: true,
            clave: true,
            tipo: true,
            unidad: true,
          },
        },
      },
    });

    return valores.map((v) => this.mapToResponse(v));
  }

  /**
   * Validar que los atributos existen y pertenecen a la empresa
   */
  private async validateAtributos(
    empresaId: string,
    atributos: AtributoValorDto[],
  ): Promise<void> {
    const atributoIds = atributos.map((a) => a.atributoId);

    const atributosExistentes = await this.prisma.productoAtributo.findMany({
      where: {
        id: { in: atributoIds },
        empresaId,
      },
    });

    if (atributosExistentes.length !== atributoIds.length) {
      const faltantes = atributoIds.filter(
        (id) => !atributosExistentes.find((a) => a.id === id),
      );
      throw new BadRequestException(
        `Los siguientes atributos no existen o no pertenecen a la empresa: ${faltantes.join(', ')}`,
      );
    }

    // Validar que los valores sean coherentes con el tipo de atributo
    for (const atributo of atributos) {
      const plantilla = atributosExistentes.find((a) => a.id === atributo.atributoId);
      if (!plantilla) continue;

      // Validar según tipo
      switch (plantilla.tipo) {
        case AtributoTipo.NUMERO:
          if (isNaN(Number(atributo.valor))) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" requiere un valor numérico, recibido: ${atributo.valor}`,
            );
          }
          break;

        case AtributoTipo.BOOLEAN:
          if (atributo.valor !== 'true' && atributo.valor !== 'false') {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" requiere un valor booleano (true/false), recibido: ${atributo.valor}`,
            );
          }
          break;

        case AtributoTipo.SELECT:
        case AtributoTipo.MULTI_SELECT:
          // Verificar que el valor esté en los valores predefinidos
          if (plantilla.valores.length > 0 && !plantilla.valores.includes(atributo.valor)) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" solo acepta los valores: ${plantilla.valores.join(', ')}. Recibido: ${atributo.valor}`,
            );
          }
          break;
      }
    }
  }

  /**
   * Mapear a response
   */
  private mapToResponse(valor: any): AtributoValorResponse {
    return {
      id: valor.id,
      productoId: valor.productoId,
      varianteId: valor.varianteId,
      atributoId: valor.atributoId,
      valor: valor.valor,
      atributo: {
        nombre: valor.atributo.nombre,
        clave: valor.atributo.clave,
        tipo: valor.atributo.tipo,
        unidad: valor.atributo.unidad,
      },
    };
  }
}
