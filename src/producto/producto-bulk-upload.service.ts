import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, TipoCambioPrecio } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { AppLoggerService } from 'src/common/logger';
import { CacheService } from '../redis/cache.service';
import { RowError, BulkUploadResult } from './dto/bulk-upload-producto.dto';
import * as ExcelJS from 'exceljs';

const Decimal = Prisma.Decimal;

const MAX_ROWS = 1000;

interface ParsedRow {
  fila: number;
  nombre: string;
  descripcion?: string;
  sku?: string;
  codigoBarras?: string;
  categoriaNombre?: string;
  marcaNombre?: string;
  unidadNombre?: string;
  peso?: number;
  precioVenta?: number;
  precioCosto?: number;
  precioIncluyeIgv: boolean;
  stockInicial?: number;
  // Precio por mayor (PRECIO_FIJO) — opcional. Si están ambos, se crea
  // un PrecioNivel asociado al producto.
  cantidadMinPorMayor?: number;
  precioPorMayor?: number;
  // Disponible para venta (isActive). Si vacío, default `true`. Si "No"
  // o "0" o false, el producto se crea inactivo (no aparece en POS / Venta
  // Rápida hasta activarlo manualmente).
  disponibleParaVenta: boolean;
}

/** Resuelve el "nombre visible" de una EmpresaCategoria / EmpresaMarca / EmpresaUnidadMedida */
function resolveName(record: any, masterKey: string): string {
  return (
    record.nombreLocal ||
    record[masterKey]?.nombre ||
    record.nombrePersonalizado ||
    ''
  );
}

@Injectable()
export class ProductoBulkUploadService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configCodigosService: ConfiguracionCodigosService,
    private readonly cache: CacheService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoBulkUploadService.name);
  }

  /**
   * Genera plantilla Excel dinámica con categorías, marcas y unidades de la empresa
   */
  async generateTemplate(empresaId: string): Promise<Buffer> {
    // Cargar datos de referencia de la empresa
    const [categoriasRaw, marcasRaw, unidadesRaw] = await Promise.all([
      this.prisma.empresaCategoria.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
          categoriaMaestra: { select: { nombre: true } },
        },
        orderBy: { nombrePersonalizado: 'asc' },
      }),
      this.prisma.empresaMarca.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
          marcaMaestra: { select: { nombre: true } },
        },
        orderBy: { nombrePersonalizado: 'asc' },
      }),
      this.prisma.empresaUnidadMedida.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
          unidadMaestra: { select: { nombre: true } },
        },
        orderBy: { nombrePersonalizado: 'asc' },
      }),
    ]);

    // Resolver nombres visibles
    const categorias = categoriasRaw.map(c => ({ id: c.id, nombre: resolveName(c, 'categoriaMaestra') })).filter(c => c.nombre);
    const marcas = marcasRaw.map(m => ({ id: m.id, nombre: resolveName(m, 'marcaMaestra') })).filter(m => m.nombre);
    const unidades = unidadesRaw.map(u => ({ id: u.id, nombre: resolveName(u, 'unidadMaestra') })).filter(u => u.nombre);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    // ========== Sheet 1: Productos ==========
    const sheet = workbook.addWorksheet('Productos');

    const headers = [
      'Nombre *',
      'Descripcion',
      'SKU',
      'Codigo de Barras',
      'Categoria',
      'Marca',
      'Unidad de Medida',
      'Peso (kg)',
      'Precio Venta',
      'Precio Costo',
      'Precio Incluye IGV',
      'Stock Inicial',
      'Cantidad Min Por Mayor',
      'Precio Por Mayor (Fijo)',
      'Disponible para Venta',
    ];

    const headerRow = sheet.addRow(headers);

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1565C0' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });

    sheet.columns = [
      { width: 30 },
      { width: 40 },
      { width: 15 },
      { width: 18 },
      { width: 20 },
      { width: 20 },
      { width: 18 },
      { width: 12 },
      { width: 15 },
      { width: 15 },
      { width: 20 },
      { width: 14 },
      { width: 18 }, // M: Cantidad Min Por Mayor
      { width: 20 }, // N: Precio Por Mayor (Fijo)
      { width: 20 }, // O: Disponible para Venta (Si/No, default Si)
    ];

    // Fila de ejemplo
    const exampleRow = sheet.addRow([
      'Producto Ejemplo',
      'Descripcion del producto',
      'SKU-001',
      '7501234567890',
      categorias.length > 0 ? categorias[0].nombre : '',
      marcas.length > 0 ? marcas[0].nombre : '',
      unidades.length > 0 ? unidades[0].nombre : 'UNIDAD',
      0.5,
      100,
      50,
      'Si',
      10,
      6,    // M: aplica precio por mayor desde 6 unidades
      80,   // N: precio por mayor S/ 80 (debe ser < precio venta = 100)
      'Si', // O: disponible para venta (Si por defecto)
    ]);

    exampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF999999' } };
    });

    // ========== Sheet 2: Referencia ==========
    const refSheet = workbook.addWorksheet('Referencia');

    const refHeaders = ['Categorias', 'Marcas', 'Unidades de Medida'];
    const refHeaderRow = refSheet.addRow(refHeaders);
    refHeaderRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4CAF50' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center' };
    });

    refSheet.columns = [
      { width: 30 },
      { width: 30 },
      { width: 30 },
    ];

    const maxRefRows = Math.max(categorias.length, marcas.length, unidades.length);
    for (let i = 0; i < maxRefRows; i++) {
      refSheet.addRow([
        categorias[i]?.nombre || '',
        marcas[i]?.nombre || '',
        unidades[i]?.nombre || '',
      ]);
    }

    // Data validation (dropdowns) - limit to 100 rows to keep file small
    const validationRows = Math.min(100, MAX_ROWS) + 1;

    if (categorias.length > 0) {
      const catList = categorias.map(c => c.nombre).join(',');
      if (catList.length <= 255) {
        for (let row = 2; row <= validationRows; row++) {
          sheet.getCell(`E${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${catList}"`],
            showErrorMessage: true,
            errorTitle: 'Categoria invalida',
            error: 'Seleccione una categoria de la lista o vea la hoja Referencia',
          };
        }
      }
    }

    if (marcas.length > 0) {
      const marcaList = marcas.map(m => m.nombre).join(',');
      if (marcaList.length <= 255) {
        for (let row = 2; row <= validationRows; row++) {
          sheet.getCell(`F${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${marcaList}"`],
            showErrorMessage: true,
            errorTitle: 'Marca invalida',
            error: 'Seleccione una marca de la lista o vea la hoja Referencia',
          };
        }
      }
    }

    if (unidades.length > 0) {
      const unidadList = unidades.map(u => u.nombre).join(',');
      if (unidadList.length <= 255) {
        for (let row = 2; row <= validationRows; row++) {
          sheet.getCell(`G${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${unidadList}"`],
            showErrorMessage: true,
            errorTitle: 'Unidad invalida',
            error: 'Seleccione una unidad de la lista o vea la hoja Referencia',
          };
        }
      }
    }

    // Data validation para "Precio Incluye IGV" (columna K) - dropdown Si/No
    for (let row = 2; row <= validationRows; row++) {
      sheet.getCell(`K${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Si,No"'],
        showErrorMessage: true,
        errorTitle: 'Valor invalido',
        error: 'Seleccione Si o No',
      };
    }

    // Data validation para "Disponible para Venta" (columna O) - dropdown Si/No
    // Si vacío, default Si (disponible). El producto se crea inactivo si pone No.
    for (let row = 2; row <= validationRows; row++) {
      sheet.getCell(`O${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Si,No"'],
        showErrorMessage: true,
        errorTitle: 'Valor invalido',
        error: 'Seleccione Si o No (vacio = Si por defecto)',
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as ArrayBuffer);
  }

  /**
   * Parsea y valida el archivo Excel, crea productos válidos y reporta errores
   */
  async parseAndValidate(
    fileBuffer: Buffer,
    empresaId: string,
    userId: string,
    sedesIds?: string[],
  ): Promise<BulkUploadResult> {
    // 1. Leer Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer);

    const sheet = workbook.getWorksheet('Productos') || workbook.getWorksheet(1);
    if (!sheet) {
      throw new BadRequestException('No se encontró la hoja "Productos" en el archivo Excel');
    }

    // 2. Pre-cargar lookups
    const [categoriasRaw, marcasRaw, unidadesRaw, existingSkus] = await Promise.all([
      this.prisma.empresaCategoria.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
          categoriaMaestra: { select: { nombre: true } },
        },
      }),
      this.prisma.empresaMarca.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
          marcaMaestra: { select: { nombre: true } },
        },
      }),
      this.prisma.empresaUnidadMedida.findMany({
        where: { empresaId, isActive: true, deletedAt: null },
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
          unidadMaestra: { select: { nombre: true } },
        },
      }),
      // Pre-cargar SKUs existentes (incluye soft-deleted) para detectar
      // colisiones antes de intentar el insert. El @@unique([empresaId, sku])
      // de Prisma aplica a TODAS las filas, incluyendo deletedAt != null;
      // si filtráramos solo isActive=true, intentaríamos crear y Prisma
      // fallaría con error críptico de unique constraint sin mensaje claro
      // al usuario.
      this.prisma.producto.findMany({
        where: { empresaId, sku: { not: null } },
        select: { sku: true },
      }),
    ]);

    // Mapas case-insensitive: nombre visible → id
    const categoriaMap = new Map<string, string>();
    for (const c of categoriasRaw) {
      const nombre = resolveName(c, 'categoriaMaestra');
      if (nombre) categoriaMap.set(nombre.toLowerCase().trim(), c.id);
    }

    const marcaMap = new Map<string, string>();
    for (const m of marcasRaw) {
      const nombre = resolveName(m, 'marcaMaestra');
      if (nombre) marcaMap.set(nombre.toLowerCase().trim(), m.id);
    }

    const unidadMap = new Map<string, string>();
    for (const u of unidadesRaw) {
      const nombre = resolveName(u, 'unidadMaestra');
      if (nombre) unidadMap.set(nombre.toLowerCase().trim(), u.id);
    }

    const existingSkuSet = new Set(existingSkus.map(p => p.sku?.toLowerCase().trim()));

    // 3. Resolver sedes
    let sedesResueltas: string[] = [];
    if (sedesIds && sedesIds.length > 0) {
      const sedesValidas = await this.prisma.sede.findMany({
        where: { id: { in: sedesIds }, empresaId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      sedesResueltas = sedesValidas.map(s => s.id);
      if (sedesResueltas.length === 0) {
        throw new BadRequestException('Ninguna de las sedes proporcionadas es válida');
      }
    } else {
      const sedePrincipal = await this.prisma.sede.findFirst({
        where: { empresaId, esPrincipal: true, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (sedePrincipal) {
        sedesResueltas = [sedePrincipal.id];
      } else {
        const primeraSede = await this.prisma.sede.findFirst({
          where: { empresaId, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (primeraSede) {
          sedesResueltas = [primeraSede.id];
        } else {
          throw new BadRequestException('No hay sedes disponibles para la empresa');
        }
      }
    }

    // 4. Parsear filas
    const errors: RowError[] = [];
    const validRows: (ParsedRow & {
      categoriaId?: string;
      marcaId?: string;
      unidadId?: string;
    })[] = [];
    const skusEnArchivo = new Set<string>();

    let rowCount = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      rowCount++;
      if (rowCount > MAX_ROWS) return;

      const getCellValue = (col: number): string => {
        const cell = row.getCell(col);
        if (cell.value === null || cell.value === undefined) return '';
        return String(cell.value).trim();
      };

      const getNumericValue = (col: number): number | undefined => {
        const cell = row.getCell(col);
        if (cell.value === null || cell.value === undefined || cell.value === '') return undefined;
        const num = Number(cell.value);
        return isNaN(num) ? undefined : num;
      };

      const nombre = getCellValue(1);
      const descripcion = getCellValue(2) || undefined;
      const sku = getCellValue(3) || undefined;
      const codigoBarras = getCellValue(4) || undefined;
      const categoriaNombre = getCellValue(5) || undefined;
      const marcaNombre = getCellValue(6) || undefined;
      const unidadNombre = getCellValue(7) || undefined;
      const peso = getNumericValue(8);
      const precioVenta = getNumericValue(9);
      const precioCosto = getNumericValue(10);
      const precioIncluyeIgvRaw = getCellValue(11).toLowerCase();
      const precioIncluyeIgv = precioIncluyeIgvRaw === 'si' || precioIncluyeIgvRaw === 'sí';
      const stockInicial = getNumericValue(12);
      const cantidadMinPorMayor = getNumericValue(13);
      const precioPorMayor = getNumericValue(14);
      // Disponible para venta (columna O). Vacío → true (default).
      // Acepta "Si"/"Sí"/"true"/"1" como sí; "No"/"false"/"0" como no.
      const disponibleRaw = getCellValue(15).toLowerCase().trim();
      const disponibleParaVenta =
        disponibleRaw === '' ||
        disponibleRaw === 'si' ||
        disponibleRaw === 'sí' ||
        disponibleRaw === 'true' ||
        disponibleRaw === '1';

      // Fila completamente vacía - saltar
      if (!nombre && !sku && !descripcion && !categoriaNombre) return;

      let rowHasError = false;
      const addError = (columna: string, valor: any, mensaje: string) => {
        errors.push({ fila: rowNumber, columna, valor, mensaje });
        rowHasError = true;
      };

      // Validar nombre
      if (!nombre) {
        addError('Nombre', nombre, 'El nombre es obligatorio');
      }

      // Validar categoría
      let categoriaId: string | undefined;
      if (categoriaNombre) {
        categoriaId = categoriaMap.get(categoriaNombre.toLowerCase().trim());
        if (!categoriaId) {
          addError('Categoria', categoriaNombre, `La categoria "${categoriaNombre}" no existe en la empresa`);
        }
      }

      // Validar marca
      let marcaId: string | undefined;
      if (marcaNombre) {
        marcaId = marcaMap.get(marcaNombre.toLowerCase().trim());
        if (!marcaId) {
          addError('Marca', marcaNombre, `La marca "${marcaNombre}" no existe en la empresa`);
        }
      }

      // Validar unidad de medida
      let unidadId: string | undefined;
      if (unidadNombre) {
        unidadId = unidadMap.get(unidadNombre.toLowerCase().trim());
        if (!unidadId) {
          addError('Unidad de Medida', unidadNombre, `La unidad "${unidadNombre}" no existe`);
        }
      }

      // Validar SKU duplicado
      if (sku) {
        const skuLower = sku.toLowerCase().trim();
        if (existingSkuSet.has(skuLower)) {
          addError('SKU', sku, `El SKU "${sku}" ya existe en la base de datos`);
        }
        if (skusEnArchivo.has(skuLower)) {
          addError('SKU', sku, `El SKU "${sku}" esta duplicado en el archivo`);
        }
        skusEnArchivo.add(skuLower);
      }

      // Validar campos numéricos
      if (peso !== undefined && peso < 0) {
        addError('Peso (kg)', peso, 'El peso no puede ser negativo');
      }
      if (precioVenta !== undefined && precioVenta < 0) {
        addError('Precio Venta', precioVenta, 'El precio de venta no puede ser negativo');
      }
      if (precioCosto !== undefined && precioCosto < 0) {
        addError('Precio Costo', precioCosto, 'El precio de costo no puede ser negativo');
      }
      // Validar "Precio Incluye IGV" solo si se escribió algo
      if (precioIncluyeIgvRaw && precioIncluyeIgvRaw !== 'si' && precioIncluyeIgvRaw !== 'sí' && precioIncluyeIgvRaw !== 'no') {
        addError('Precio Incluye IGV', getCellValue(11), 'El valor debe ser Si o No');
      }
      // Validar "Disponible para Venta" solo si se escribió algo
      const disponibleParsed = ['', 'si', 'sí', 'no', 'true', 'false', '1', '0'];
      if (disponibleRaw && !disponibleParsed.includes(disponibleRaw)) {
        addError('Disponible para Venta', getCellValue(15), 'El valor debe ser Si o No (vacio = Si)');
      }
      if (stockInicial !== undefined) {
        if (stockInicial < 0) {
          addError('Stock Inicial', stockInicial, 'El stock inicial no puede ser negativo');
        }
        if (!Number.isInteger(stockInicial)) {
          addError('Stock Inicial', stockInicial, 'El stock inicial debe ser un numero entero');
        }
      }

      // Validar numeric parse errors
      const pesoRaw = getCellValue(8);
      if (pesoRaw && peso === undefined) {
        addError('Peso (kg)', pesoRaw, 'El valor no es un numero valido');
      }
      const precioVentaRaw = getCellValue(9);
      if (precioVentaRaw && precioVenta === undefined) {
        addError('Precio Venta', precioVentaRaw, 'El valor no es un numero valido');
      }
      const precioCostoRaw = getCellValue(10);
      if (precioCostoRaw && precioCosto === undefined) {
        addError('Precio Costo', precioCostoRaw, 'El valor no es un numero valido');
      }
      const stockInicialRaw = getCellValue(12);
      if (stockInicialRaw && stockInicial === undefined) {
        addError('Stock Inicial', stockInicialRaw, 'El valor no es un numero valido');
      }

      // Validar precio por mayor (PRECIO_FIJO) — opcional pero ambos campos
      // van de la mano: si pones uno debes poner el otro.
      const cantidadMinRaw = getCellValue(13);
      const precioMayorRaw = getCellValue(14);
      if (cantidadMinRaw && cantidadMinPorMayor === undefined) {
        addError(
          'Cantidad Min Por Mayor',
          cantidadMinRaw,
          'El valor no es un numero valido',
        );
      }
      if (precioMayorRaw && precioPorMayor === undefined) {
        addError(
          'Precio Por Mayor (Fijo)',
          precioMayorRaw,
          'El valor no es un numero valido',
        );
      }
      const tieneCantidad = cantidadMinPorMayor !== undefined;
      const tienePrecio = precioPorMayor !== undefined;
      if (tieneCantidad !== tienePrecio) {
        // Solo uno de los dos fue completado.
        if (tieneCantidad) {
          addError(
            'Precio Por Mayor (Fijo)',
            '',
            'Falta el precio por mayor (la cantidad esta llena)',
          );
        } else {
          addError(
            'Cantidad Min Por Mayor',
            '',
            'Falta la cantidad minima (el precio por mayor esta lleno)',
          );
        }
      }
      if (tieneCantidad && tienePrecio) {
        if (!Number.isInteger(cantidadMinPorMayor) || cantidadMinPorMayor! < 2) {
          addError(
            'Cantidad Min Por Mayor',
            cantidadMinPorMayor,
            'Debe ser un entero mayor o igual a 2',
          );
        }
        if (precioPorMayor! <= 0) {
          addError(
            'Precio Por Mayor (Fijo)',
            precioPorMayor,
            'El precio por mayor debe ser mayor a 0',
          );
        }
        if (precioVenta !== undefined && precioPorMayor! >= precioVenta) {
          addError(
            'Precio Por Mayor (Fijo)',
            precioPorMayor,
            'Debe ser menor al Precio Venta',
          );
        }
        if (precioVenta === undefined) {
          addError(
            'Precio Venta',
            '',
            'Para configurar precio por mayor, el Precio Venta es obligatorio',
          );
        }
      }

      if (!rowHasError) {
        validRows.push({
          fila: rowNumber,
          nombre,
          descripcion,
          sku,
          codigoBarras,
          categoriaNombre,
          marcaNombre,
          unidadNombre,
          peso,
          precioVenta,
          precioCosto,
          precioIncluyeIgv,
          stockInicial: stockInicial !== undefined ? Math.floor(stockInicial) : undefined,
          cantidadMinPorMayor: cantidadMinPorMayor !== undefined
            ? Math.floor(cantidadMinPorMayor)
            : undefined,
          precioPorMayor,
          disponibleParaVenta,
          categoriaId,
          marcaId,
          unidadId,
        });
      }
    });

    if (rowCount > MAX_ROWS) {
      throw new BadRequestException(
        `El archivo tiene mas de ${MAX_ROWS} filas. Por favor divida el archivo en partes mas pequenas.`,
      );
    }

    if (validRows.length === 0 && errors.length === 0) {
      throw new BadRequestException(
        'El archivo no contiene datos. Agregue productos a partir de la fila 2.',
      );
    }

    // 5. Crear productos válidos en transacción
    const productosCreados: { id: string; nombre: string; codigoEmpresa: string }[] = [];

    if (validRows.length > 0) {
      await this.prisma.$transaction(
        async (tx) => {
          for (const row of validRows) {
            const sedeId = sedesResueltas[0];
            const { codigoEmpresa, codigoSistema } =
              await this.configCodigosService.generarCodigoProducto(
                empresaId,
                sedeId,
                tx,
              );

            const producto = await tx.producto.create({
              data: {
                empresaId,
                sedeId,
                nombre: row.nombre,
                descripcion: row.descripcion,
                sku: row.sku || null,
                codigoBarras: row.codigoBarras || null,
                codigoEmpresa,
                codigoSistema,
                empresaCategoriaId: row.categoriaId || null,
                empresaMarcaId: row.marcaId || null,
                unidadMedidaId: row.unidadId || null,
                peso: row.peso ?? null,
                // Por defecto NO visible en marketplace al subir por bulk:
                // el usuario revisa los productos primero (precio, imágenes,
                // descripción) antes de exponerlos al público. Activar
                // visibilidad uno a uno desde el detalle del producto.
                visibleMarketplace: false,
                // Disponible para venta (columna O del Excel). Default true
                // si vacío. Si "No" → producto creado pero inactivo (no
                // aparece en POS/Venta Rápida hasta activarlo).
                isActive: row.disponibleParaVenta,
                destacado: false,
                tieneVariantes: false,
                esCombo: false,
              },
            });

            productosCreados.push({
              id: producto.id,
              nombre: producto.nombre,
              codigoEmpresa: producto.codigoEmpresa,
            });

            // Crear ProductoStock en cada sede con precios y stock del Excel
            for (const sid of sedesResueltas) {
              const stockInicial = row.stockInicial || 0;

              const productoStock = await tx.productoStock.create({
                data: {
                  empresaId,
                  sedeId: sid,
                  productoId: producto.id,
                  varianteId: null,
                  stockActual: stockInicial,
                  stockMinimo: null,
                  stockMaximo: null,
                  ubicacion: null,
                  precio: row.precioVenta ?? null,
                  precioCosto: row.precioCosto ?? null,
                  precioOferta: null,
                  enOferta: false,
                  fechaInicioOferta: null,
                  fechaFinOferta: null,
                  precioConfigurado: row.precioVenta != null,
                  precioIncluyeIgv: row.precioIncluyeIgv,
                },
              });

              // Registrar historial de precios si se configuró precio
              if (row.precioVenta != null || row.precioCosto != null) {
                await tx.productoPrecioHistorialSede.create({
                  data: {
                    productoStockId: productoStock.id,
                    sedeId: sid,
                    precioAnterior: null,
                    precioNuevo: row.precioVenta != null
                      ? new Decimal(row.precioVenta)
                      : null,
                    precioCostoAnterior: null,
                    precioCostoNuevo: row.precioCosto != null
                      ? new Decimal(row.precioCosto)
                      : null,
                    tipoCambio: TipoCambioPrecio.MASIVO,
                    razon: 'Precio inicial por carga masiva Excel',
                    origenModulo: 'INVENTARIO',
                    usuarioId: userId,
                  },
                });
              }

              if (stockInicial > 0) {
                await tx.movimientoStock.create({
                  data: {
                    empresaId,
                    sedeId: sid,
                    productoStockId: productoStock.id,
                    tipo: 'AJUSTE_ENTRADA',
                    cantidadAnterior: 0,
                    cantidad: stockInicial,
                    cantidadNueva: stockInicial,
                    motivo: 'Stock inicial por carga masiva Excel',
                    usuarioId: userId,
                  },
                });
              }
            }

            // Crear PrecioNivel "Por Mayor" si se especificó en el Excel.
            // Va por producto (no por sede) — el nivel aplica a todas las
            // sedes donde se vende este producto.
            if (
              row.cantidadMinPorMayor !== undefined &&
              row.precioPorMayor !== undefined
            ) {
              await tx.precioNivel.create({
                data: {
                  productoId: producto.id,
                  varianteId: null,
                  nombre: 'Por Mayor',
                  cantidadMinima: row.cantidadMinPorMayor,
                  cantidadMaxima: null,
                  tipoPrecio: 'PRECIO_FIJO',
                  precio: new Decimal(row.precioPorMayor),
                  porcentajeDesc: null,
                  orden: 0,
                  isActive: true,
                  descripcion: 'Creado por carga masiva Excel',
                },
              });
            }
          }
        },
        { timeout: 60000 },
      );

      // Invalidar cache de productos y stats de la empresa
      try {
        const statsKey = this.cache.getEmpresaStatsKey(empresaId);
        await this.cache.invalidate(statsKey);
        await this.cache.invalidateProductosLists(empresaId);
        this.logger.debug(`Cache invalidada tras carga masiva para empresa ${empresaId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Error al invalidar cache tras carga masiva: ${errorMessage}`);
      }

      this.logger.log(
        `Carga masiva: ${productosCreados.length} productos creados para empresa ${empresaId}`,
      );
    }

    return {
      totalFilas: validRows.length + errors.length,
      creados: productosCreados.length,
      errores: errors.length,
      detalleErrores: errors,
      productosCreados,
    };
  }
}
