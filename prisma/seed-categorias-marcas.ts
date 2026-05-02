import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function seedCategoriasMaestras() {
  console.log('🌱 Seeding Categorías Maestras...');

  const categorias = [
    // Nivel 1: Categorías principales
    {
      nombre: 'Electrónica',
      slug: 'electronica',
      descripcion: 'Productos electrónicos y tecnología',
      icono: '📱',
      nivel: 0,
      orden: 1,
      esPopular: true,
    },
    {
      nombre: 'Ropa y Accesorios',
      slug: 'ropa-accesorios',
      descripcion: 'Moda, ropa y accesorios',
      icono: '👕',
      nivel: 0,
      orden: 2,
      esPopular: true,
    },
    {
      nombre: 'Hogar y Jardín',
      slug: 'hogar-jardin',
      descripcion: 'Artículos para el hogar y jardín',
      icono: '🏠',
      nivel: 0,
      orden: 3,
    },
    {
      nombre: 'Deportes',
      slug: 'deportes',
      descripcion: 'Artículos deportivos y fitness',
      icono: '⚽',
      nivel: 0,
      orden: 4,
      esPopular: true,
    },
    {
      nombre: 'Alimentos y Bebidas',
      slug: 'alimentos-bebidas',
      descripcion: 'Productos alimenticios',
      icono: '🍕',
      nivel: 0,
      orden: 5,
    },
    {
      nombre: 'Belleza y Salud',
      slug: 'belleza-salud',
      descripcion: 'Productos de belleza y cuidado personal',
      icono: '💄',
      nivel: 0,
      orden: 6,
    },
    {
      nombre: 'Juguetes y Bebés',
      slug: 'juguetes-bebes',
      descripcion: 'Juguetes y productos para bebés',
      icono: '🧸',
      nivel: 0,
      orden: 7,
    },
    {
      nombre: 'Automotriz',
      slug: 'automotriz',
      descripcion: 'Accesorios y repuestos automotrices',
      icono: '🚗',
      nivel: 0,
      orden: 8,
    },
  ];

  // Crear categorías principales
  const createdCategories = [];
  for (const cat of categorias) {
    const created = await prisma.categoriaMaestra.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
    createdCategories.push(created);
    console.log(`✅ Categoría creada: ${created.nombre}`);
  }

  // Subcategorías de Electrónica
  const electronica = createdCategories.find((c) => c.slug === 'electronica');
  if (electronica) {
    const subcategorias = [
      {
        nombre: 'Smartphones',
        slug: 'smartphones',
        descripcion: 'Teléfonos inteligentes y celulares',
        icono: '📱',
        padreId: electronica.id,
        nivel: 1,
        orden: 1,
        esPopular: true,
      },
      {
        nombre: 'Laptops y Computadoras',
        slug: 'laptops-computadoras',
        descripcion: 'Laptops, PCs de escritorio y todo en uno',
        icono: '💻',
        padreId: electronica.id,
        nivel: 1,
        orden: 2,
        esPopular: true,
      },
      {
        nombre: 'Tablets',
        slug: 'tablets',
        descripcion: 'Tabletas y iPads',
        icono: '📱',
        padreId: electronica.id,
        nivel: 1,
        orden: 3,
        esPopular: true,
      },
      {
        nombre: 'Audio y Video',
        slug: 'audio-video',
        descripcion: 'Audífonos, parlantes, equipos de sonido',
        icono: '🎧',
        padreId: electronica.id,
        nivel: 1,
        orden: 4,
        esPopular: true,
      },
      {
        nombre: 'Televisores',
        slug: 'televisores',
        descripcion: 'Smart TVs, pantallas y proyectores',
        icono: '📺',
        padreId: electronica.id,
        nivel: 1,
        orden: 5,
        esPopular: true,
      },
      {
        nombre: 'Cámaras',
        slug: 'camaras',
        descripcion: 'Cámaras digitales, DSLR, acción y seguridad',
        icono: '📷',
        padreId: electronica.id,
        nivel: 1,
        orden: 6,
      },
      {
        nombre: 'Gaming',
        slug: 'gaming',
        descripcion: 'Consolas, videojuegos y accesorios gaming',
        icono: '🎮',
        padreId: electronica.id,
        nivel: 1,
        orden: 7,
        esPopular: true,
      },
      {
        nombre: 'Smartwatches',
        slug: 'smartwatches',
        descripcion: 'Relojes inteligentes y wearables',
        icono: '⌚',
        padreId: electronica.id,
        nivel: 1,
        orden: 8,
      },
      {
        nombre: 'Componentes PC',
        slug: 'componentes-pc',
        descripcion: 'Procesadores, RAM, tarjetas gráficas, motherboards',
        icono: '🔧',
        padreId: electronica.id,
        nivel: 1,
        orden: 9,
      },
      {
        nombre: 'Almacenamiento',
        slug: 'almacenamiento',
        descripcion: 'Discos duros, SSD, memorias USB, tarjetas SD',
        icono: '💾',
        padreId: electronica.id,
        nivel: 1,
        orden: 10,
      },
      {
        nombre: 'Redes',
        slug: 'redes',
        descripcion: 'Routers, switches, adaptadores WiFi',
        icono: '🌐',
        padreId: electronica.id,
        nivel: 1,
        orden: 11,
      },
      {
        nombre: 'Impresoras',
        slug: 'impresoras',
        descripcion: 'Impresoras, scanners y multifuncionales',
        icono: '🖨️',
        padreId: electronica.id,
        nivel: 1,
        orden: 12,
      },
      {
        nombre: 'Software',
        slug: 'software',
        descripcion: 'Licencias de software, apps y programas',
        icono: '💿',
        padreId: electronica.id,
        nivel: 1,
        orden: 13,
      },
      {
        nombre: 'Accesorios Electrónicos',
        slug: 'accesorios-electronicos',
        descripcion: 'Cables, cargadores, adaptadores y más',
        icono: '🔌',
        padreId: electronica.id,
        nivel: 1,
        orden: 14,
      },
    ];

    for (const subcat of subcategorias) {
      await prisma.categoriaMaestra.upsert({
        where: { slug: subcat.slug },
        update: {},
        create: subcat,
      });
      console.log(`  ✅ Subcategoría: ${subcat.nombre}`);
    }
  }

  // Subcategorías de Ropa
  const ropa = createdCategories.find((c) => c.slug === 'ropa-accesorios');
  if (ropa) {
    const subcategorias = [
      { nombre: 'Ropa de Hombre', slug: 'ropa-hombre', padreId: ropa.id, nivel: 1, orden: 1 },
      { nombre: 'Ropa de Mujer', slug: 'ropa-mujer', padreId: ropa.id, nivel: 1, orden: 2 },
      { nombre: 'Ropa de Niños', slug: 'ropa-ninos', padreId: ropa.id, nivel: 1, orden: 3 },
      { nombre: 'Calzado', slug: 'calzado', padreId: ropa.id, nivel: 1, orden: 4, esPopular: true },
      { nombre: 'Accesorios de Moda', slug: 'accesorios-moda', padreId: ropa.id, nivel: 1, orden: 5 },
    ];

    for (const subcat of subcategorias) {
      await prisma.categoriaMaestra.upsert({
        where: { slug: subcat.slug },
        update: {},
        create: subcat,
      });
      console.log(`  ✅ Subcategoría: ${subcat.nombre}`);
    }
  }

  console.log('✨ Categorías Maestras completadas\n');
}

async function seedMarcasMaestras() {
  console.log('🌱 Seeding Marcas Maestras...');

  const marcas = [
    // Electrónica
    { nombre: 'Apple', slug: 'apple', paisOrigen: 'USA', esPopular: true, logo: 'https://example.com/logos/apple.png' },
    { nombre: 'Samsung', slug: 'samsung', paisOrigen: 'Corea del Sur', esPopular: true },
    { nombre: 'Xiaomi', slug: 'xiaomi', paisOrigen: 'China', esPopular: true },
    { nombre: 'Huawei', slug: 'huawei', paisOrigen: 'China' },
    { nombre: 'Sony', slug: 'sony', paisOrigen: 'Japón', esPopular: true },
    { nombre: 'LG', slug: 'lg', paisOrigen: 'Corea del Sur' },
    { nombre: 'Dell', slug: 'dell', paisOrigen: 'USA' },
    { nombre: 'HP', slug: 'hp', paisOrigen: 'USA' },
    { nombre: 'Lenovo', slug: 'lenovo', paisOrigen: 'China' },
    { nombre: 'Asus', slug: 'asus', paisOrigen: 'Taiwán' },
    { nombre: 'Microsoft', slug: 'microsoft', paisOrigen: 'USA', esPopular: true },
    { nombre: 'Canon', slug: 'canon', paisOrigen: 'Japón' },
    { nombre: 'Nikon', slug: 'nikon', paisOrigen: 'Japón' },
    { nombre: 'Bose', slug: 'bose', paisOrigen: 'USA' },
    { nombre: 'JBL', slug: 'jbl', paisOrigen: 'USA' },

    // Ropa y Deportes
    { nombre: 'Nike', slug: 'nike', paisOrigen: 'USA', esPopular: true },
    { nombre: 'Adidas', slug: 'adidas', paisOrigen: 'Alemania', esPopular: true },
    { nombre: 'Puma', slug: 'puma', paisOrigen: 'Alemania' },
    { nombre: 'Reebok', slug: 'reebok', paisOrigen: 'USA' },
    { nombre: 'Under Armour', slug: 'under-armour', paisOrigen: 'USA' },
    { nombre: 'New Balance', slug: 'new-balance', paisOrigen: 'USA' },
    { nombre: 'Zara', slug: 'zara', paisOrigen: 'España', esPopular: true },
    { nombre: "H&M", slug: 'hm', paisOrigen: 'Suecia' },
    { nombre: 'Uniqlo', slug: 'uniqlo', paisOrigen: 'Japón' },
    { nombre: 'Gap', slug: 'gap', paisOrigen: 'USA' },
    { nombre: 'Levis', slug: 'levis', paisOrigen: 'USA' },

    // Belleza
    { nombre: "L'Oréal", slug: 'loreal', paisOrigen: 'Francia', esPopular: true },
    { nombre: 'Maybelline', slug: 'maybelline', paisOrigen: 'USA' },
    { nombre: 'MAC', slug: 'mac', paisOrigen: 'USA' },
    { nombre: 'Nivea', slug: 'nivea', paisOrigen: 'Alemania' },
    { nombre: 'Dove', slug: 'dove', paisOrigen: 'UK' },

    // Alimentos
    { nombre: 'Coca-Cola', slug: 'coca-cola', paisOrigen: 'USA', esPopular: true },
    { nombre: 'Pepsi', slug: 'pepsi', paisOrigen: 'USA' },
    { nombre: 'Nestlé', slug: 'nestle', paisOrigen: 'Suiza', esPopular: true },
    { nombre: 'Danone', slug: 'danone', paisOrigen: 'Francia' },
    { nombre: 'Kelloggs', slug: 'kelloggs', paisOrigen: 'USA' },

    // Hogar
    { nombre: 'IKEA', slug: 'ikea', paisOrigen: 'Suecia', esPopular: true },
    { nombre: 'Philips', slug: 'philips', paisOrigen: 'Países Bajos' },
    { nombre: 'Panasonic', slug: 'panasonic', paisOrigen: 'Japón' },
    { nombre: 'Whirlpool', slug: 'whirlpool', paisOrigen: 'USA' },

    // Genérica
    { nombre: 'Genérica', slug: 'generica', descripcion: 'Marca genérica para productos sin marca específica' },
  ];

  for (const marca of marcas) {
    await prisma.marcaMaestra.upsert({
      where: { slug: marca.slug },
      update: {},
      create: marca,
    });
    console.log(`✅ Marca creada: ${marca.nombre}`);
  }

  console.log('✨ Marcas Maestras completadas\n');
}

async function main() {
  console.log('🚀 Iniciando seed de Catálogos Maestros...\n');

  try {
    await seedCategoriasMaestras();
    await seedMarcasMaestras();

    console.log('✅ ¡Seed completado exitosamente!');
  } catch (error) {
    console.error('❌ Error en seed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
