import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Mantiene `Producto.textoBusqueda`, la columna que alimenta la búsqueda
 * unificada (ver `texto-busqueda.util.ts` para el porqué).
 *
 * Se llena en SQL y no en TypeScript por una razón concreta: el nombre de la
 * marca y el de la categoría **no son campos**, son
 * `nombreLocal ?? nombrePersonalizado ?? maestra.nombre`. Resolver eso desde
 * el service obligaría a traer las dos relaciones en cada guardado; en SQL
 * son dos subconsultas que Postgres resuelve de una.
 *
 * 🔑 La normalización de acá (`lower(unaccent(...))`) tiene que dar lo mismo
 * que `normalizarBusqueda()` del util. Si cambia una, cambia la otra, o la
 * búsqueda deja de matchear **en silencio**.
 *
 * ⚠️ Siempre bumpea `actualizadoEn`: sin eso el catálogo del celular nunca se
 * entera del cambio, porque el sync diferencial se guía por esa fecha.
 */
@Injectable()
export class TextoBusquedaService {
  private readonly logger = new Logger(TextoBusquedaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** El UPDATE, con el filtro que decide a qué productos alcanza. */
  private sentencia(filtro: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      UPDATE "Producto" p
      SET "textoBusqueda" = lower(unaccent(concat_ws(' ',
            p."nombre",
            p."descripcion",
            p."codigoEmpresa",
            p."sku",
            p."codigoBarras",
            (SELECT coalesce(m."nombreLocal", m."nombrePersonalizado", mm."nombre")
               FROM "EmpresaMarca" m
               LEFT JOIN "MarcaMaestra" mm ON mm."id" = m."marcaMaestraId"
              WHERE m."id" = p."empresaMarcaId"),
            (SELECT coalesce(c."nombreLocal", c."nombrePersonalizado", cm."nombre")
               FROM "EmpresaCategoria" c
               LEFT JOIN "CategoriaMaestra" cm ON cm."id" = c."categoriaMaestraId"
              WHERE c."id" = p."empresaCategoriaId")
          ))),
          "actualizadoEn" = now()
      WHERE ${filtro}
    `;
  }

  /**
   * Nunca lanza: que falle el índice de búsqueda no puede tumbar el guardado
   * del producto ni el renombrado de una marca. Queda el aviso en el log y el
   * texto se rehace en la próxima edición.
   */
  private async ejecutar(filtro: Prisma.Sql, contexto: string): Promise<number> {
    try {
      const filas = await this.prisma.$executeRaw(this.sentencia(filtro));
      return filas;
    } catch (e: any) {
      this.logger.warn(
        `No se pudo recalcular textoBusqueda (${contexto}): ${String(e?.message ?? e)}`,
      );
      return 0;
    }
  }

  /** Tras crear o editar un producto. */
  async recalcularProducto(productoId: string): Promise<void> {
    await this.ejecutar(
      Prisma.sql`p."id" = ${productoId}`,
      `producto ${productoId}`,
    );
  }

  /**
   * Tras renombrar una marca. Alcanza a TODOS sus productos: el nombre de la
   * marca está copiado dentro de cada `textoBusqueda`, así que si no se
   * rehacen quedan buscándose por el nombre viejo.
   */
  async recalcularPorMarca(empresaMarcaId: string): Promise<number> {
    const filas = await this.ejecutar(
      Prisma.sql`p."empresaMarcaId" = ${empresaMarcaId}`,
      `marca ${empresaMarcaId}`,
    );
    if (filas > 0) {
      this.logger.log(`textoBusqueda rehecho en ${filas} productos (marca)`);
    }
    return filas;
  }

  /** Tras renombrar una categoría. Mismo motivo que la marca. */
  async recalcularPorCategoria(empresaCategoriaId: string): Promise<number> {
    const filas = await this.ejecutar(
      Prisma.sql`p."empresaCategoriaId" = ${empresaCategoriaId}`,
      `categoría ${empresaCategoriaId}`,
    );
    if (filas > 0) {
      this.logger.log(`textoBusqueda rehecho en ${filas} productos (categoría)`);
    }
    return filas;
  }
}
