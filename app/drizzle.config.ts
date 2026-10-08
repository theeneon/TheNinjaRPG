import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./drizzle/schema.ts",
  dialect: "mysql",
  ...(process.env.MYSQL_URL ? { dbCredentials: { url: process.env.MYSQL_URL } } : {}),
  // Keep SQL directly pasteable into database consoles, without statement-breakpoint markers.
  breakpoints: false,
  verbose: true, 
});
