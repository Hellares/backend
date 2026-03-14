ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN     "etiquetaCondicionEquipo" TEXT,
ADD COLUMN     "etiquetaMarcaEquipo" TEXT,
ADD COLUMN     "etiquetaNumeroSerie" TEXT,
ADD COLUMN     "etiquetaSeccionEquipo" TEXT,
ADD COLUMN     "etiquetaTipoEquipo" TEXT,
ADD COLUMN     "mostrarSeccionEquipo" BOOLEAN NOT NULL DEFAULT true;
