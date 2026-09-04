import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupIntegration } from "./helpers.js";

const { client } = setupIntegration();

describe("platform behaviour", () => {
  it("GET /health reports ok with a live database", async () => {
    const c = client();
    const res = await c.req("GET", "/health");
    assert.equal(res.status, 200);
    const body = res.json as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.db, "up");
  });

  it("unknown API routes return JSON 404, not HTML", async () => {
    const c = client();
    const res = await c.req("GET", "/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: "Not found" });
  });

  it("malformed JSON returns JSON 400, not an HTML stack trace", async () => {
    const c = client();
    const raw = await fetch(c.base + "/api/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json", Origin: c.created.config.BETTER_AUTH_URL },
      body: "{oops",
    });
    assert.equal(raw.status, 400);
    assert.deepEqual(await raw.json(), { error: "Malformed JSON in request body." });
  });

  it("unauthenticated sync access returns JSON 401", async () => {
    const c = client();
    for (const [method, path] of [["GET", "/api/sync"], ["PUT", "/api/sync"], ["GET", "/api/sync/meta"], ["GET", "/api/sync/export"]] as const) {
      const res = await c.req(method, path, method === "PUT" ? { profile: {}, library: [], sources: [] } : undefined);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.deepEqual(res.json, { error: "Unauthorized" });
    }
    const del = await c.req("DELETE", "/api/account", { password: "x" });
    assert.equal(del.status, 401);
  });

  it("security headers are present and X-Powered-By is hidden", async () => {
    const c = client();
    const res = await c.req("GET", "/health");
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});
