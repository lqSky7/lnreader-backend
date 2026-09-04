import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prisma } from "../src/prisma.js";
import { setupIntegration, signUpTestUser } from "./helpers.js";

const { client } = setupIntegration();

describe("email/username auth", () => {
  it("signs up with email+username and starts a session", async () => {
    const c = client();
    const u = await signUpTestUser(c);
    const me = await c.req("GET", "/api/auth/get-session");
    assert.equal(me.status, 200);
    const user = (me.json as { user: Record<string, unknown> }).user;
    assert.equal(user.email, u.email);
    assert.equal(user.username, u.username);
  });

  it("rejects duplicate email and duplicate username", async () => {
    const c = client();
    const u = await signUpTestUser(c);
    const dupEmail = await c.req("POST", "/api/auth/sign-up/email", {
      name: "other",
      email: u.email,
      password: "password123",
      username: `other_${Date.now().toString(36)}`,
      displayUsername: "other",
    });
    assert.ok(dupEmail.status >= 400, `expected 4xx, got ${dupEmail.status}`);

    const dupUser = await c.req("POST", "/api/auth/sign-up/email", {
      name: "other",
      email: `other_${Date.now().toString(36)}@example.com`,
      password: "password123",
      username: u.username,
      displayUsername: u.username,
    });
    assert.ok(dupUser.status >= 400, `expected 4xx, got ${dupUser.status}`);
  });

  it("rejects weak passwords and bad emails", async () => {
    const c = client();
    const tag = Date.now().toString(36);
    const weak = await c.req("POST", "/api/auth/sign-up/email", {
      name: "weak",
      email: `weak_${tag}@example.com`,
      password: "short",
      username: `weak_${tag}`,
      displayUsername: "weak",
    });
    assert.ok(weak.status >= 400);
    const badEmail = await c.req("POST", "/api/auth/sign-up/email", {
      name: "bad",
      email: "not-an-email",
      password: "password123",
      username: `bad_${tag}`,
      displayUsername: "bad",
    });
    assert.ok(badEmail.status >= 400);
  });

  it("signs in with email and with username; wrong password fails", async () => {
    const c = client();
    const u = await signUpTestUser(c);

    c.jar.clear();
    const emailLogin = await c.req("POST", "/api/auth/sign-in/email", {
      email: u.email,
      password: u.password,
    });
    assert.equal(emailLogin.status, 200);

    c.jar.clear();
    const userLogin = await c.req("POST", "/api/auth/sign-in/username", {
      username: u.username,
      password: u.password,
    });
    assert.equal(userLogin.status, 200);

    c.jar.clear();
    const bad = await c.req("POST", "/api/auth/sign-in/email", {
      email: u.email,
      password: "wrong-password",
    });
    assert.equal(bad.status, 401);
  });

  it("sign-out destroys the session", async () => {
    const c = client();
    await signUpTestUser(c);
    const out = await c.req("POST", "/api/auth/sign-out", {});
    assert.equal(out.status, 200);
    const sync = await c.req("GET", "/api/sync");
    assert.equal(sync.status, 401);
  });

  it("password-reset request accepts the iOS deep-link redirect (regression)", async () => {
    const c = client();
    const u = await signUpTestUser(c);
    // This exact shape is what the iOS client sends. It used to fail with
    // INVALID_REDIRECT_URL because the custom scheme wasn't trusted.
    const res = await c.req("POST", "/api/auth/request-password-reset", {
      email: u.email,
      redirectTo: "lnreader://reset-password",
    });
    assert.equal(res.status, 200, `reset request failed: ${JSON.stringify(res.json)}`);
  });

  it("full password-reset flow works with the emailed token", async () => {
    const c = client();
    const u = await signUpTestUser(c);
    await c.req("POST", "/api/auth/request-password-reset", {
      email: u.email,
      redirectTo: "lnreader://reset-password",
    });
    // better-auth stores `reset-password:<token>` as identifier and the user id as value.
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
    const verification = await prisma.verification.findFirst({
      where: { identifier: { startsWith: "reset-password:" }, value: { contains: dbUser.id } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(verification, "expected a verification row for the reset token");
    // better-auth stores the raw token in the identifier: `reset-password:<token>`.
    const prefix = "reset-password:";
    assert.ok(verification.identifier.startsWith(prefix));
    const token = verification.identifier.slice(prefix.length);

    const reset = await c.req("POST", "/api/auth/reset-password", {
      token,
      newPassword: "brand-new-password-9",
    });
    assert.equal(reset.status, 200, `reset failed: ${JSON.stringify(reset.json)}`);

    c.jar.clear();
    const login = await c.req("POST", "/api/auth/sign-in/email", {
      email: u.email,
      password: "brand-new-password-9",
    });
    assert.equal(login.status, 200);
  });

  it("reset with a bogus token fails", async () => {
    const c = client();
    await signUpTestUser(c);
    const reset = await c.req("POST", "/api/auth/reset-password", {
      token: "bogus-token",
      newPassword: "brand-new-password-9",
    });
    assert.ok(reset.status >= 400);
  });
});
