/**
 * Script para poblar la base de datos con el catálogo maestro de Unidades de Medida SUNAT
 *
 * Ejecutar con:
 * npx ts-node prisma/seed-unidades-medida.ts
 *
 * O agregar al package.json:
 * "prisma": {
 *   "seed": "ts-node prisma/seed-unidades-medida.ts"
 * }
 */

import { PrismaClient, CategoriaUnidad } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Catálogo oficial SUNAT de unidades de medida
// Referencia: https://cpe.sunat.gob.pe/sites/default/files/inline-files/Catalogo_06_20180731.xlsx
const UNIDADES_SUNAT = [
  // =========================================
  // CANTIDAD (Unidades discretas)
  // =========================================
  {
    codigo: 'NIU',
    nombre: 'Unidad',
    simbolo: 'und',
    descripcion: 'Unidad (bienes)',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: true,
    orden: 1,
  },
  {
    codigo: 'ZZ',
    nombre: 'Servicio',
    simbolo: 'svc',
    descripcion: 'Unidad de servicio',
    categoria: CategoriaUnidad.SERVICIO,
    esPopular: true,
    orden: 2,
  },
  {
    codigo: 'BX',
    nombre: 'Caja',
    simbolo: 'cja',
    descripcion: 'Caja de productos',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: true,
    orden: 3,
  },
  {
    codigo: 'PK',
    nombre: 'Paquete',
    simbolo: 'paq',
    descripcion: 'Paquete',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: true,
    orden: 4,
  },
  {
    codigo: 'DZN',
    nombre: 'Docena',
    simbolo: 'doc',
    descripcion: '12 unidades',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: false,
    orden: 10,
  },
  {
    codigo: 'GR',
    nombre: 'Gruesa',
    simbolo: 'gru',
    descripcion: '12 docenas (144 unidades)',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: false,
    orden: 11,
  },
  {
    codigo: 'MIL',
    nombre: 'Millar',
    simbolo: 'mil',
    descripcion: '1000 unidades',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: false,
    orden: 12,
  },
  {
    codigo: 'PR',
    nombre: 'Par',
    simbolo: 'par',
    descripcion: '2 unidades',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: false,
    orden: 13,
  },
  {
    codigo: 'SET',
    nombre: 'Juego',
    simbolo: 'set',
    descripcion: 'Conjunto o juego',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: false,
    orden: 14,
  },
  {
    codigo: '4A',
    nombre: 'Bobina',
    simbolo: 'bob',
    descripcion: 'Bobina o carrete',
    categoria: CategoriaUnidad.CANTIDAD,
    esPopular: false,
    orden: 15,
  },

  // =========================================
  // MASA (Peso)
  // =========================================
  {
    codigo: 'KGM',
    nombre: 'Kilogramo',
    simbolo: 'kg',
    descripcion: 'Kilogramo (1000 gramos)',
    categoria: CategoriaUnidad.MASA,
    esPopular: true,
    orden: 5,
  },
  {
    codigo: 'GRM',
    nombre: 'Gramo',
    simbolo: 'g',
    descripcion: 'Gramo',
    categoria: CategoriaUnidad.MASA,
    esPopular: true,
    orden: 6,
  },
  {
    codigo: 'TNE',
    nombre: 'Tonelada',
    simbolo: 't',
    descripcion: 'Tonelada métrica (1000 kg)',
    categoria: CategoriaUnidad.MASA,
    esPopular: false,
    orden: 20,
  },
  {
    codigo: 'LBR',
    nombre: 'Libra',
    simbolo: 'lb',
    descripcion: 'Libra (0.453592 kg)',
    categoria: CategoriaUnidad.MASA,
    esPopular: false,
    orden: 21,
  },
  {
    codigo: 'ONZ',
    nombre: 'Onza',
    simbolo: 'oz',
    descripcion: 'Onza (28.35 gramos)',
    categoria: CategoriaUnidad.MASA,
    esPopular: false,
    orden: 22,
  },
  {
    codigo: 'MGM',
    nombre: 'Miligramo',
    simbolo: 'mg',
    descripcion: 'Miligramo (0.001 gramos)',
    categoria: CategoriaUnidad.MASA,
    esPopular: false,
    orden: 23,
  },

  // =========================================
  // LONGITUD
  // =========================================
  {
    codigo: 'MTR',
    nombre: 'Metro',
    simbolo: 'm',
    descripcion: 'Metro',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: true,
    orden: 7,
  },
  {
    codigo: 'CMT',
    nombre: 'Centímetro',
    simbolo: 'cm',
    descripcion: 'Centímetro (0.01 metros)',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: false,
    orden: 30,
  },
  {
    codigo: 'MMT',
    nombre: 'Milímetro',
    simbolo: 'mm',
    descripcion: 'Milímetro (0.001 metros)',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: false,
    orden: 31,
  },
  {
    codigo: 'KMT',
    nombre: 'Kilómetro',
    simbolo: 'km',
    descripcion: 'Kilómetro (1000 metros)',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: false,
    orden: 32,
  },
  {
    codigo: 'INH',
    nombre: 'Pulgada',
    simbolo: 'in',
    descripcion: 'Pulgada (2.54 cm)',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: false,
    orden: 33,
  },
  {
    codigo: 'FOT',
    nombre: 'Pie',
    simbolo: 'ft',
    descripcion: 'Pie (30.48 cm)',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: false,
    orden: 34,
  },
  {
    codigo: 'YRD',
    nombre: 'Yarda',
    simbolo: 'yd',
    descripcion: 'Yarda (0.9144 metros)',
    categoria: CategoriaUnidad.LONGITUD,
    esPopular: false,
    orden: 35,
  },

  // =========================================
  // ÁREA
  // =========================================
  {
    codigo: 'MTK',
    nombre: 'Metro cuadrado',
    simbolo: 'm²',
    descripcion: 'Metro cuadrado',
    categoria: CategoriaUnidad.AREA,
    esPopular: true,
    orden: 8,
  },
  {
    codigo: 'CMK',
    nombre: 'Centímetro cuadrado',
    simbolo: 'cm²',
    descripcion: 'Centímetro cuadrado',
    categoria: CategoriaUnidad.AREA,
    esPopular: false,
    orden: 40,
  },
  {
    codigo: 'KMK',
    nombre: 'Kilómetro cuadrado',
    simbolo: 'km²',
    descripcion: 'Kilómetro cuadrado',
    categoria: CategoriaUnidad.AREA,
    esPopular: false,
    orden: 41,
  },
  {
    codigo: 'HAR',
    nombre: 'Hectárea',
    simbolo: 'ha',
    descripcion: 'Hectárea (10,000 m²)',
    categoria: CategoriaUnidad.AREA,
    esPopular: false,
    orden: 42,
  },
  {
    codigo: 'FTK',
    nombre: 'Pie cuadrado',
    simbolo: 'ft²',
    descripcion: 'Pie cuadrado',
    categoria: CategoriaUnidad.AREA,
    esPopular: false,
    orden: 43,
  },

  // =========================================
  // VOLUMEN
  // =========================================
  {
    codigo: 'LTR',
    nombre: 'Litro',
    simbolo: 'L',
    descripcion: 'Litro',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: true,
    orden: 9,
  },
  {
    codigo: 'MLT',
    nombre: 'Mililitro',
    simbolo: 'ml',
    descripcion: 'Mililitro (0.001 litros)',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: false,
    orden: 50,
  },
  {
    codigo: 'MTQ',
    nombre: 'Metro cúbico',
    simbolo: 'm³',
    descripcion: 'Metro cúbico',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: false,
    orden: 51,
  },
  {
    codigo: 'GLL',
    nombre: 'Galón',
    simbolo: 'gal',
    descripcion: 'Galón (3.785 litros)',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: false,
    orden: 52,
  },
  {
    codigo: 'CMQ',
    nombre: 'Centímetro cúbico',
    simbolo: 'cm³',
    descripcion: 'Centímetro cúbico',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: false,
    orden: 53,
  },
  {
    codigo: 'PTI',
    nombre: 'Pinta',
    simbolo: 'pt',
    descripcion: 'Pinta (0.473 litros)',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: false,
    orden: 54,
  },
  {
    codigo: 'GLI',
    nombre: 'Galón UK',
    simbolo: 'gal UK',
    descripcion: 'Galón imperial (4.546 litros)',
    categoria: CategoriaUnidad.VOLUMEN,
    esPopular: false,
    orden: 55,
  },

  // =========================================
  // TIEMPO
  // =========================================
  {
    codigo: 'HUR',
    nombre: 'Hora',
    simbolo: 'hr',
    descripcion: 'Hora',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: true,
    orden: 60,
  },
  {
    codigo: 'MIN',
    nombre: 'Minuto',
    simbolo: 'min',
    descripcion: 'Minuto',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: false,
    orden: 61,
  },
  {
    codigo: 'SEC',
    nombre: 'Segundo',
    simbolo: 's',
    descripcion: 'Segundo',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: false,
    orden: 62,
  },
  {
    codigo: 'DAY',
    nombre: 'Día',
    simbolo: 'día',
    descripcion: 'Día',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: false,
    orden: 63,
  },
  {
    codigo: 'WEE',
    nombre: 'Semana',
    simbolo: 'sem',
    descripcion: 'Semana',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: false,
    orden: 64,
  },
  {
    codigo: 'MON',
    nombre: 'Mes',
    simbolo: 'mes',
    descripcion: 'Mes',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: false,
    orden: 65,
  },
  {
    codigo: 'ANN',
    nombre: 'Año',
    simbolo: 'año',
    descripcion: 'Año',
    categoria: CategoriaUnidad.TIEMPO,
    esPopular: false,
    orden: 66,
  },

  // =========================================
  // SERVICIO (Unidades especiales)
  // =========================================
  {
    codigo: 'ACT',
    nombre: 'Actividad',
    simbolo: 'act',
    descripcion: 'Actividad o evento',
    categoria: CategoriaUnidad.SERVICIO,
    esPopular: false,
    orden: 70,
  },
  {
    codigo: 'E48',
    nombre: 'Sesión',
    simbolo: 'ses',
    descripcion: 'Sesión de servicio',
    categoria: CategoriaUnidad.SERVICIO,
    esPopular: false,
    orden: 71,
  },
  {
    codigo: 'E51',
    nombre: 'Trabajo',
    simbolo: 'trab',
    descripcion: 'Trabajo o labor',
    categoria: CategoriaUnidad.SERVICIO,
    esPopular: false,
    orden: 72,
  },
];

async function main() {
  console.log('🌱 Iniciando seed de Unidades de Medida SUNAT...\n');

  // Limpiar tabla existente (opcional - comentar si no deseas borrar)
  // await prisma.unidadMedidaMaestra.deleteMany();
  // console.log('🗑️  Tabla UnidadMedidaMaestra limpiada\n');

  let creadas = 0;
  let actualizadas = 0;
  let errores = 0;

  for (const unidad of UNIDADES_SUNAT) {
    try {
      const existe = await prisma.unidadMedidaMaestra.findUnique({
        where: { codigo: unidad.codigo },
      });

      if (existe) {
        // Actualizar si ya existe
        await prisma.unidadMedidaMaestra.update({
          where: { codigo: unidad.codigo },
          data: unidad,
        });
        actualizadas++;
        console.log(`✏️  Actualizada: ${unidad.codigo} - ${unidad.nombre}`);
      } else {
        // Crear si no existe
        await prisma.unidadMedidaMaestra.create({
          data: unidad,
        });
        creadas++;
        console.log(`✅ Creada: ${unidad.codigo} - ${unidad.nombre}`);
      }
    } catch (error) {
      errores++;
      console.error(`❌ Error con ${unidad.codigo}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Resumen:`);
  console.log(`   ✅ Unidades creadas: ${creadas}`);
  console.log(`   ✏️  Unidades actualizadas: ${actualizadas}`);
  console.log(`   ❌ Errores: ${errores}`);
  console.log(`   📦 Total procesadas: ${UNIDADES_SUNAT.length}`);
  console.log('='.repeat(60));

  // Mostrar estadísticas por categoría
  console.log('\n📈 Unidades por categoría:');
  const stats = await prisma.unidadMedidaMaestra.groupBy({
    by: ['categoria'],
    _count: true,
  });

  for (const stat of stats) {
    console.log(`   ${stat.categoria}: ${stat._count} unidades`);
  }

  console.log('\n✅ Seed de Unidades de Medida completado!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error fatal en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
