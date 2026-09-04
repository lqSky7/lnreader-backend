import "dotenv/config";

import cors from "cors";
import express from "express";
import { Prisma } from "@prisma/client";
import { verifyPassword } from "better-auth/crypto";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createAuth, type Auth } from "./auth.js";
import { loadConfig, type AppConfig } from "./config.js";
import { prisma } from "./prisma.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import { isStaleWrite, syncPayloadSchema } from "./sync-schema.js";

export interface CreatedApp {
  app: express.Express;
  auth: Auth;
  config: AppConfig;
  authLimiter: RateLimiter;
}

function serializeSync(sync: { profile: unknown; library: unknown; sources: unknown; updatedAt: Date }) {
  return {
    profile: sync.profile,
    library: sync.library,
    sources: sync.sources,
    updatedAt: sync.updatedAt.toISOString(),
  };
}

export function createApp(overrides?: { config?: AppConfig; auth?: Auth }): CreatedApp {
  const config = overrides?.config ?? loadConfig();
  const auth = overrides?.auth ?? createAuth(config);

  const app = express();
  app.disable("x-powered-by");
  // Behind Azure App Service / proxies so secure cookies + client IPs work.
  app.set("trust proxy", 1);

  // --- Minimal security headers (API-only; no frontend to break). ---
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // --- Request logging (opt out in tests). ---
  if (config.NODE_ENV !== "test") {
    app.use((req, res, next) => {
      const started = Date.now();
      res.on("finish", () => {
        console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
      });
      next();
    });
  }

  // --- CORS. A literal "*" must never be combined with credentials
  // (browsers reject it); reflect the request origin instead. ---
  if (config.reflectOrigin && config.NODE_ENV !== "test") {
    console.warn('[cors] CLIENT_ORIGIN contains "*": reflecting request origins. Set explicit origins in production.');
  }
  app.use(
    cors({
      origin: config.reflectOrigin ? true : config.clientOrigins,
      credentials: true,
    })
  );

  const authLimiter = createRateLimiter({
    windowMs: config.RATE_LIMIT_AUTH_WINDOW_MS,
    max: config.RATE_LIMIT_AUTH_MAX,
    message: "Too many auth attempts, please try again later.",
  });
  app.use("/api/auth/", authLimiter.middleware);

  // Better Auth must receive the raw request body, so mount it before express.json().
  app.all("/api/auth/*", toNodeHandler(auth));

  app.use(express.json({ limit: config.SYNC_BODY_LIMIT }));

  async function requireSession(req: express.Request, res: express.Response) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    return session;
  }

  // --- Health: actually checks the database instead of blindly saying ok. ---
  const startedAt = Date.now();
  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: "up", uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
    } catch {
      res.status(503).json({ ok: false, db: "down", uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
    }
  });

  app.get("/api/sync", async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      const sync = await prisma.userSync.findUnique({
        where: { userId: session.user.id },
      });

      res.json({
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
          username: "username" in session.user ? session.user.username : null,
          displayUsername: "displayUsername" in session.user ? session.user.displayUsername : null,
        },
        data: sync ? serializeSync(sync) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // Cheap polling endpoint so clients can check for changes without
  // downloading the whole library payload.
  app.get("/api/sync/meta", async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      const sync = await prisma.userSync.findUnique({
        where: { userId: session.user.id },
        select: { updatedAt: true },
      });

      res.json({ updatedAt: sync ? sync.updatedAt.toISOString() : null });
    } catch (err) {
      next(err);
    }
  });

  // Full backup download (same shape as GET /api/sync).
  app.get("/api/sync/export", async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      const sync = await prisma.userSync.findUnique({
        where: { userId: session.user.id },
      });

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Disposition", `attachment; filename="lnreader-backup-${stamp}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        user: { id: session.user.id, email: session.user.email },
        data: sync ? serializeSync(sync) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  app.put("/api/sync", async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      const parsed = syncPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid sync payload", details: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.userSync.findUnique({
        where: { userId: session.user.id },
      });

      // Conflict detection: a stale device must not silently clobber newer data.
      if (existing && isStaleWrite(parsed.data.clientUpdatedAt, existing.updatedAt)) {
        res.status(409).json({
          error: "Sync conflict: server holds newer data. Fetch latest before overwriting.",
          serverUpdatedAt: existing.updatedAt.toISOString(),
          data: serializeSync(existing),
        });
        return;
      }

      const syncData = {
        profile: parsed.data.profile as Prisma.InputJsonValue,
        library: parsed.data.library as Prisma.InputJsonValue,
        sources: parsed.data.sources as Prisma.InputJsonValue,
      };

      const saved = await prisma.userSync.upsert({
        where: { userId: session.user.id },
        update: syncData,
        create: {
          userId: session.user.id,
          ...syncData,
        },
      });

      res.json({
        ok: true,
        updatedAt: saved.updatedAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // Account deletion (App Store requirement + user right). Requires the
  // account password as confirmation; cascades to sessions/accounts/sync rows.
  app.delete("/api/account", async (req, res, next) => {
    try {
      const session = await requireSession(req, res);
      if (!session) return;

      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!password) {
        res.status(400).json({ error: "Password confirmation is required to delete your account." });
        return;
      }

      const credential = await prisma.account.findFirst({
        where: { userId: session.user.id, providerId: "credential" },
        select: { password: true },
      });
      if (!credential?.password) {
        res.status(400).json({ error: "Account deletion with password confirmation is only available for email/password accounts." });
        return;
      }

      const ok = await verifyPassword({ hash: credential.password, password });
      if (!ok) {
        res.status(403).json({ error: "Incorrect password." });
        return;
      }

      await prisma.user.delete({ where: { id: session.user.id } });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // --- JSON 404 for unknown API routes (Express default is an HTML page). ---
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // --- JSON error handler. Must be last. Converts body-parser SyntaxErrors
  // (malformed JSON) and any other failure into JSON instead of HTML + stack traces. ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof SyntaxError && "body" in (err as unknown as Record<string, unknown>)) {
      res.status(400).json({ error: "Malformed JSON in request body." });
      return;
    }
    console.error("[http] unhandled error", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return { app, auth, config, authLimiter };
}

/** Fail fast when migrations were never applied instead of 500ing later. */
export async function assertDatabaseReady(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "user" LIMIT 1`;
  } catch (err) {
    // P2021 = table does not exist; P2010 = raw probe query failed (on this
    // exact query that can only mean the tables are missing — connection
    // failures surface as PrismaClientInitializationError instead).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2021" || err.code === "P2010")
    ) {
      throw new Error('Database tables are missing — run "prisma migrate deploy" first.');
    }
    throw err;
  }
}

export async function start(): Promise<void> {
  const { app, config } = createApp();

  try {
    await prisma.$connect();
    await assertDatabaseReady();
  } catch (err) {
    console.error("[startup] database is not ready:", err instanceof Error ? err.message : err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }

  const server = app.listen(config.PORT, () => {
    console.log(`LNReader sync backend listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}, closing...`);
    server.close(async () => {
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    });
    // Force out if connections hang.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    console.error("[process] unhandledRejection", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[process] uncaughtException", err);
    process.exit(1);
  });
}

// Auto-start when run directly (`npm start`), but NOT when imported by tests.
if (process.env.NODE_ENV !== "test") {
  void start();
}
