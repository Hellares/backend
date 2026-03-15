/**
 * Script para limpiar la base de datos manteniendo datos maestros
 *
 * MANTIENE:
 * - PlanSuscripcion (planes de suscripción)
 * - CategoriaMaestra (catálogo de categorías)
 * - MarcaMaestra (catálogo de marcas)
 * - UnidadMedidaMaestra (catálogo de unidades de medida SUNAT)
 *
 * ELIMINA: Todo lo demás (empresas, usuarios, productos, servicios, etc.)
 *
 * Uso: npx ts-node prisma/cleanup-db.ts
 */

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  console.log('🧹 Iniciando limpieza de base de datos...\n');

  // Orden de eliminación respetando foreign keys (más específico → más general)
  const tablesToClean = [
    // Notificaciones
    'Notificacion',
    'PreferenciaNotificacion',
    'DispositivoNotificacion',

    // Citas
    'ItemCita',
    'Cita',

    // Vinculación B2B
    'VinculacionEmpresa',

    // Incidencias
    'ItemReporteIncidencia',
    'ReporteIncidencia',

    // Facturación / Documentos
    'ItemComprobanteElectronico',
    'ComprobanteElectronico',
    'SerieDocumento',
    'ConfiguracionDocumento',
    'ConfiguracionFacturacion',

    // Cotizaciones
    'ItemCotizacion',
    'Cotizacion',

    // Compras
    'ItemOrdenCompra',
    'OrdenCompra',
    'ItemCompra',
    'Compra',
    'Lote',

    // Stock / Inventario
    'MovimientoStock',
    'ItemTransferencia',
    'TransferenciaStock',
    'ItemInventario',
    'Inventario',
    'StockSede',
    'AlertaStockBajo',

    // Servicios
    'ItemOrdenServicio',
    'OrdenServicio',
    'ComponenteEquipo',
    'ModeloEquipo',
    'TipoComponente',
    'PlantillaServicio',
    'ConfiguracionCampoServicio',
    'Servicio',

    // Productos
    'ProductoComboComponente',
    'ProductoCombo',
    'VarianteProducto',
    'AtributoProducto',
    'PlantillaAtributo',
    'OpcionAtributo',
    'Compatibilidad',
    'ConfiguracionPrecio',
    'Producto',

    // Proveedores
    'Proveedor',

    // Descuentos
    'PoliticaDescuentoUsuario',
    'PoliticaDescuentoProducto',
    'PoliticaDescuento',

    // Archivos
    'Archivo',

    // Configuraciones de empresa
    'ConfiguracionCodigos',
    'ConfiguracionEmpresa',
    'PersonalizacionEmpresa',

    // Relaciones empresa-catálogo
    'EmpresaCategoria',
    'EmpresaMarca',
    'EmpresaUnidadMedida',

    // Clientes / Registro
    'HistorialEstadoCliente',
    'RegistroCliente',

    // Usuarios y roles
    'UsuarioSedeRol',
    'EmpresaUsuarioRol',
    'EmpresaPersona',
    'AuthProvider',

    // Sedes
    'DireccionSede',
    'Sede',

    // Usuarios y personas
    'Usuario',
    'DireccionPersona',
    'Persona',

    // Empresa (al final, tiene FK a PlanSuscripcion que se mantiene)
    'Empresa',
  ];

  let cleaned = 0;
  let skipped = 0;

  for (const table of tablesToClean) {
    try {
      // Usar $executeRawUnsafe para TRUNCATE con CASCADE
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
      console.log(`  ✅ ${table} — limpiado`);
      cleaned++;
    } catch (error: any) {
      // Si la tabla no existe, solo avisar
      if (error?.message?.includes('does not exist') || error?.code === '42P01') {
        console.log(`  ⏭️  ${table} — no existe, saltando`);
        skipped++;
      } else {
        console.log(`  ❌ ${table} — error: ${error?.message || error}`);
      }
    }
  }

  console.log(`\n✨ Limpieza completada: ${cleaned} tablas limpiadas, ${skipped} saltadas`);
  console.log('\n📦 Datos preservados:');

  const [planes, categorias, marcas, unidades] = await Promise.all([
    prisma.planSuscripcion.count(),
    prisma.categoriaMaestra.count(),
    prisma.marcaMaestra.count(),
    prisma.unidadMedidaMaestra.count(),
  ]);

  console.log(`  - PlanSuscripcion: ${planes} registros`);
  console.log(`  - CategoriaMaestra: ${categorias} registros`);
  console.log(`  - MarcaMaestra: ${marcas} registros`);
  console.log(`  - UnidadMedidaMaestra: ${unidades} registros`);
}

cleanup()
  .catch((e) => {
    console.error('❌ Error durante la limpieza:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
