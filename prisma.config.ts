import { defineConfig, env } from "prisma/config";
import "dotenv/config"; // Cargar variables de entorno del .env

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
