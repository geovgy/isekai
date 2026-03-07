import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .optional()
    .transform(value => value === "true"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(Bun.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Failed to parse environment variables");
}

export const env = {
  databaseUrl: parsed.data.DATABASE_URL,
  host: parsed.data.HOST,
  port: parsed.data.PORT,
  databaseSsl: parsed.data.DATABASE_SSL ?? false,
  databaseMaxConnections: parsed.data.DATABASE_MAX_CONNECTIONS,
};
