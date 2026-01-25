import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

// Cargar variables de entorno
config();

async function applyMigration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);

  const prisma = new PrismaClient({
    adapter,
  });

  try {
    const migrationPath = path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      '20260124205642_fix_transferencia_stock_unique_constraint',
      'migration.sql',
    );

    console.log('Leyendo archivo SQL:', migrationPath);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    console.log('Contenido SQL:\n', sql);
    console.log('\n--- Ejecutando migración ---\n');

    // Ejecutar el SQL completo
    await prisma.$executeRawUnsafe(sql);

    console.log('✅ Migración aplicada exitosamente');
  } catch (error) {
    console.error('❌ Error aplicando migración:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

applyMigration();
