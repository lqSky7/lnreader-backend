import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import type { AddressInfo } from "node:net";

describe("auth rate limiting", () => {
  it("returns 429 after exceeding the configured maximum", async () => {
    const base = loadConfig();
    const { app, authLimiter } = createApp({
      config: { ...base, RATE_LIMIT_AUTH_MAX: 3, RATE_LIMIT_AUTH_WINDOW_MS: 60_000 },
    });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const port = (server.address() as AddressInfo).port;
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
        });
        await res.text();
        statuses.push(res.status);
      }
      assert.ok(statuses.includes(429), `expected a 429, got [${statuses.join(", ")}]`);
      // Limiter responds with JSON + Retry-After.
      const probe = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
      });
      assert.equal(probe.status, 429);
      assert.ok(probe.headers.get("retry-after"));
      assert.deepEqual(await probe.json(), { error: "Too many auth attempts, please try again later." });
    } finally {
      authLimiter.stop();
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});
