import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // If using a separate migration/direct URL, place it here.
    // Otherwise, use env("DATABASE_URL")
    url: env("DIRECT_URL"), 
  },
});
