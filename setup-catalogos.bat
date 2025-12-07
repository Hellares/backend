@echo off
echo.
echo ============================================
echo   Configurando Catalogos Maestros
echo ============================================
echo.

echo [1/3] Sincronizando schema con la base de datos...
call npx prisma db push
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo al sincronizar el schema
    pause
    exit /b 1
)
echo OK - Schema sincronizado
echo.

echo [2/3] Generando cliente Prisma...
call npx prisma generate
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo al generar cliente
    pause
    exit /b 1
)
echo OK - Cliente generado
echo.

echo [3/3] Cargando catalogos maestros...
call npx ts-node prisma/seed-categorias-marcas.ts
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo al cargar catalogos
    pause
    exit /b 1
)
echo.
echo ============================================
echo   Configuracion completa!
echo ============================================
echo.
echo Proximos pasos:
echo 1. Ejecutar: npm run start:dev
echo 2. Probar endpoints en: http://localhost:3000/catalogos
echo 3. Swagger: http://localhost:3000/api
echo.
pause
