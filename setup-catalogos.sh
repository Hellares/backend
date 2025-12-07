#!/bin/bash

echo "🚀 Configurando Catálogos Maestros..."
echo ""

# 1. DB Push (sincronizar schema)
echo "📦 Paso 1/3: Sincronizando schema con la base de datos..."
npx prisma db push

if [ $? -ne 0 ]; then
  echo "❌ Error al sincronizar el schema"
  exit 1
fi

echo "✅ Schema sincronizado"
echo ""

# 2. Generar cliente Prisma
echo "🔧 Paso 2/3: Generando cliente Prisma..."
npx prisma generate

if [ $? -ne 0 ]; then
  echo "❌ Error al generar cliente"
  exit 1
fi

echo "✅ Cliente generado"
echo ""

# 3. Ejecutar seed
echo "🌱 Paso 3/3: Cargando catálogos maestros..."
npx ts-node prisma/seed-categorias-marcas.ts

if [ $? -ne 0 ]; then
  echo "❌ Error al cargar catálogos"
  exit 1
fi

echo ""
echo "✅ ¡Configuración completa!"
echo ""
echo "📊 Próximos pasos:"
echo "1. Ejecutar: npm run start:dev"
echo "2. Probar endpoints en: http://localhost:3000/catalogos"
echo ""
