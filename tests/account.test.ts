import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_USER, setupIntegration, signUpTestUser } from "./helpers.js";

const { client } = setupIntegration();

describe("account deletion", () => {
  it("requires a password", async () => {
    const c = client();
    await signUpTestUser(c);
    const res = await c.req("DELETE", "/api/account", {});
    assert.equal(res.status, 400);
  });

  it("rejects the wrong password", async () => {
    const c = client();
    await signUpTestUser(c);
    const res = await c.req("DELETE", "/api/account", { password: "not-my-password" });
    assert.equal(res.status, 403);
  });

  it("deletes everything and frees the email/username", async () => {
    const c = client();
    await signUpTestUser(c);
    await c.req("PUT", "/api/sync", { profile: {}, library: [], sources: [] });

    const del = await c.req("DELETE", "/api/account", { password: TEST_USER.password });
    assert.deepEqual(del.json, { ok: true });

    // Session is dead and data is gone.
    assert.equal((await c.req("GET", "/api/sync")).status, 401);

    // The email + username can be registered again.
    c.jar.clear();
    await signUpTestUser(c);
    const me = await c.req("GET", "/api/sync");
    assert.equal(me.status, 200);
    assert.equal((me.json as { data: null }).data, null);
  });
});
