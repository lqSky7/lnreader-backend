/**
 * Shared integration-test harness.
 *
 * Run with:  DATABASE_URL="postgresql://..." npm test
 * (NODE_ENV=test is set by the npm script so importing server.ts never calls listen.)
 */
import assert from "node:assert/strict";
import { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp, type CreatedApp } from "../src/server.js";
import { prisma } from "../src/prisma.js";

export interface TestClient {
  base: string;
  /** GET/POST/PUT/DELETE with JSON body, manual cookie jar + Origin header. */
  req: (
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ) => Promise<{ status: number; json: unknown; headers: Headers }>;
  jar: Map<string, string>;
  created: CreatedApp;
  close: () => Promise<void>;
}

function parseSetCookies(headers: Headers, jar: Map<string, string>) {
  // Undici Headers coalesces set-cookie; use getSetCookie when available.
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const raw: string[] = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
  for (const line of raw) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export async function truncateAll() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "user", "session", "account", "verification", "UserSync" RESTART IDENTITY CASCADE'
  );
}

/** Boot the app on an ephemeral port. Resets rate limiter + DB per file via hooks. */
export function setupIntegration(): { client: () => TestClient } {
  let holder: TestClient | undefined;

  before(async () => {
    assert.ok(
      process.env.DATABASE_URL,
      "DATABASE_URL must point at a throwaway test database when running tests"
    );
    const created = createApp();
    const { app } = created;
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const jar = new Map<string, string>();

    const req: TestClient["req"] = async (method, path, body, extraHeaders) => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        // better-auth CSRF checks require an Origin on cookie-authenticated calls.
        Origin: created.config.BETTER_AUTH_URL,
        ...extraHeaders,
      };
      if (jar.size > 0) {
        headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      }
      let payload: string | undefined;
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + path, { method, headers, body: payload });
      parseSetCookies(res.headers, jar);
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json, headers: res.headers };
    };

    holder = {
      base,
      req,
      jar,
      created,
      close: async () => {
        created.authLimiter.stop();
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      },
    };
    await truncateAll();
  });

  after(async () => {
    await holder?.close();
    await truncateAll();
  });

  return {
    client: () => {
      assert.ok(holder, "test client not initialised");
      return holder;
    },
  };
}

export const TEST_USER = {
  name: "tester",
  email: "tester@example.com",
  password: "password123",
  username: "tester",
};

let userSeq = 0;

/** Sign up with unique credentials (test files run in parallel processes). */
export async function signUpTestUser(c: TestClient, overrides?: Partial<typeof TEST_USER>) {
  userSeq += 1;
  const tag = `${Date.now().toString(36)}${process.pid.toString(36)}${userSeq}`;
  const u = {
    name: `tester-${tag}`,
    email: `tester-${tag}@example.com`,
    password: "password123",
    username: `tester_${tag}`.slice(0, 30),
    ...overrides,
  };
  const res = await c.req("POST", "/api/auth/sign-up/email", {
    name: u.name,
    email: u.email,
    password: u.password,
    username: u.username,
    displayUsername: u.username,
  });
  assert.equal(res.status, 200, `sign-up failed: ${JSON.stringify(res.json)}`);
  return u;
}
