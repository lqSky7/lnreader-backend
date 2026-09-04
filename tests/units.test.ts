import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRateLimiter } from "../src/rate-limit.js";
import { isStaleWrite } from "../src/sync-schema.js";
import type { Request, Response } from "express";

function fakeReq(ip: string, path = "/x"): Request {
  return { ip, path, socket: { remoteAddress: ip } } as unknown as Request;
}

function run(mw: (req: Request, res: Response, next: () => void) => void, ip: string) {
  let status = 200;
  let body: unknown = null;
  let nextCalled = false;
  const headers: Record<string, string> = {};
  const res = {
    status: (s: number) => ({ json: (b: unknown) => { status = s; body = b; } }),
    setHeader: (k: string, v: string) => { headers[k] = v; },
  } as unknown as Response;
  mw(fakeReq(ip), res, () => { nextCalled = true; });
  return { status, body, nextCalled, headers };
}

describe("createRateLimiter", () => {
  it("allows up to max requests then 429s with Retry-After", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    try {
      assert.ok(run(limiter.middleware, "1.1.1.1").nextCalled);
      assert.ok(run(limiter.middleware, "1.1.1.1").nextCalled);
      const blocked = run(limiter.middleware, "1.1.1.1");
      assert.equal(blocked.nextCalled, false);
      assert.equal(blocked.status, 429);
      assert.deepEqual(blocked.body, { error: "Too many requests, please try again later." });
      assert.ok(blocked.headers["Retry-After"]);
      // A different key is unaffected.
      assert.ok(run(limiter.middleware, "2.2.2.2").nextCalled);
      limiter.reset();
      assert.ok(run(limiter.middleware, "1.1.1.1").nextCalled);
    } finally {
      limiter.stop();
    }
  });
});

describe("isStaleWrite", () => {
  const server = new Date("2026-09-04T12:00:00.000Z");
  it("accepts missing/unparseable timestamps (legacy clients)", async () => {
    assert.equal(isStaleWrite(undefined, server), false);
    assert.equal(isStaleWrite("garbage", server), false);
  });
  it("detects older client copies beyond skew tolerance", async () => {
    assert.equal(isStaleWrite("2026-09-04T11:58:00.000Z", server), true);
  });
  it("accepts fresh/same-time copies", async () => {
    assert.equal(isStaleWrite("2026-09-04T12:00:00.000Z", server), false);
    assert.equal(isStaleWrite("2026-09-04T12:00:04.000Z", server), false); // within 5s skew
    assert.equal(isStaleWrite("2026-09-04T12:01:00.000Z", server), false);
  });
});
