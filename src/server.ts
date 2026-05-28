import "dotenv/config";

import cors from "cors";
import express from "express";
import { Prisma } from "@prisma/client";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { prisma } from "./prisma.js";
import { syncPayloadSchema } from "./sync-schema.js";

const app = express();
const port = Number(process.env.PORT ?? 3005);

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN?.split(",") ?? true,
    credentials: true,
  })
);

// Better Auth must receive the raw request body, so mount it before express.json().
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

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

app.get("/api/sync", async (req, res) => {
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
    data: sync
      ? {
          profile: sync.profile,
          library: sync.library,
          sources: sync.sources,
          updatedAt: sync.updatedAt,
        }
      : null,
  });
});

app.put("/api/sync", async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const parsed = syncPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sync payload", details: parsed.error.flatten() });
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
    updatedAt: saved.updatedAt,
  });
});

app.listen(port, () => {
  console.log(`LNReader sync backend listening on http://localhost:${port}`);
});
