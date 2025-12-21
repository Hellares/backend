import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

/**
 * Convierte un nombre a formato snake_case para usar como clave
 * Ejemplos:
 * "Color" -> "color"
 * "Socket del Procesador" -> "socket_del_procesador"
 * "Tipo de RAM" -> "tipo_de_ram"
 */
function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, ''); // Trim underscores from start/end
}

async function main() {
  console.log('🔄 Populating clave field for existing ProductoAtributo records...\n');

  // Get all attributes without a clave
  const atributosSinClave = await prisma.productoAtributo.findMany({
    where: {
      clave: null,
    },
    select: {
      id: true,
      empresaId: true,
      nombre: true,
      clave: true,
    },
  });

  console.log(`Found ${atributosSinClave.length} attributes without clave\n`);

  if (atributosSinClave.length === 0) {
    console.log('✅ All attributes already have a clave value!');
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const atributo of atributosSinClave) {
    const claveGenerada = toSnakeCase(atributo.nombre);

    try {
      // Check if this clave already exists for this empresa
      const existing = await prisma.productoAtributo.findUnique({
        where: {
          empresaId_clave: {
            empresaId: atributo.empresaId,
            clave: claveGenerada,
          },
        },
      });

      let finalClave = claveGenerada;

      // If it exists, append a number
      if (existing && existing.id !== atributo.id) {
        let counter = 2;
        while (true) {
          finalClave = `${claveGenerada}_${counter}`;
          const check = await prisma.productoAtributo.findUnique({
            where: {
              empresaId_clave: {
                empresaId: atributo.empresaId,
                clave: finalClave,
              },
            },
          });
          if (!check) break;
          counter++;
        }
        console.log(`⚠️  Clave "${claveGenerada}" already exists, using "${finalClave}" instead`);
      }

      await prisma.productoAtributo.update({
        where: { id: atributo.id },
        data: { clave: finalClave },
      });

      console.log(`✅ Updated: "${atributo.nombre}" -> clave: "${finalClave}"`);
      successCount++;
    } catch (error) {
      console.error(`❌ Error updating ${atributo.nombre}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n✅ Migration complete!`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
