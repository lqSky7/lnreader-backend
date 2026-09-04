import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/db)"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters — generate one with `openssl rand -base64 32`"),
  BETTER_AUTH_URL: z
    .string()
    .min(1, "BETTER_AUTH_URL is required")
    .refine((v) => {
      try {
        // eslint-disable-next-line no-new
        new URL(v);
        return true;
      } catch {
        return false;
      }
    }, "BETTER_AUTH_URL must be a valid URL and MUST match the public host the app calls (cookies/origin checks depend on it)"),
  PORT: z.coerce.number().int().positive().default(3005),
  // Comma-separated list of allowed browser origins, e.g.
  // "https://app.example.com,http://localhost:5173". A bare "*" is accepted
  // for backwards compatibility but only enables origin reflection (never a
  // literal "*" with credentials, which browsers reject).
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  // Deep link / URL the iOS app handles for password resets.
  PASSWORD_RESET_URL: z.string().default("lnreader://reset-password"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SYNC_BODY_LIMIT: z.string().default("10mb"),
  // Auth rate limit: max requests per window per IP.
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
});

export type AppConfig = z.infer<typeof envSchema> & {
  /** Parsed, trimmed CLIENT_ORIGIN entries (may contain "*"). */
  clientOrigins: string[];
  /** True when CLIENT_ORIGIN contains "*" — origins are reflected, never "*". */
  reflectOrigin: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid backend configuration:\n${lines.join("\n")}`);
  }
  const clientOrigins = parsed.data.CLIENT_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    ...parsed.data,
    clientOrigins: clientOrigins.length > 0 ? clientOrigins : ["http://localhost:5173"],
    reflectOrigin: clientOrigins.includes("*"),
  };
}
