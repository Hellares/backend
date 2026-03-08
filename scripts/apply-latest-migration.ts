import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';

config();

async function applyMigration() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const migrationDir = process.argv[2];
    if (!migrationDir) {
      console.error('Usage: npx ts-node scripts/apply-latest-migration.ts <migration_folder_name>');
      process.exit(1);
    }

    const migrationPath = path.join(__dirname, '..', 'prisma', 'migrations', migrationDir, 'migration.sql');
    console.log('Applying:', migrationPath);
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    console.log(sql);

    await prisma.$executeRawUnsafe(sql);
    console.log('Migration applied successfully');
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

applyMigration();
