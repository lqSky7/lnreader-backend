import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://api.example.com",
};

describe("loadConfig", () => {
  it("loads defaults", async () => {
    const c = loadConfig({ ...BASE });
    assert.equal(c.PORT, 3005);
    assert.deepEqual(c.clientOrigins, ["http://localhost:5173"]);
    assert.equal(c.reflectOrigin, false);
    assert.equal(c.PASSWORD_RESET_URL, "lnreader://reset-password");
  });

  it("parses a comma-separated CLIENT_ORIGIN list", async () => {
    const c = loadConfig({ ...BASE, CLIENT_ORIGIN: "https://a.example.com, http://localhost:5173 ," });
    assert.deepEqual(c.clientOrigins, ["https://a.example.com", "http://localhost:5173"]);
    assert.equal(c.reflectOrigin, false);
  });

  it("flags a wildcard origin for reflection", async () => {
    const c = loadConfig({ ...BASE, CLIENT_ORIGIN: "*" });
    assert.equal(c.reflectOrigin, true);
  });

  it("fails fast with a readable message when required vars are missing", async () => {
    assert.throws(() => loadConfig({}), /DATABASE_URL/);
    assert.throws(() => loadConfig({ ...BASE, BETTER_AUTH_SECRET: "short" }), /BETTER_AUTH_SECRET/);
    assert.throws(() => loadConfig({ ...BASE, BETTER_AUTH_URL: "not a url" }), /BETTER_AUTH_URL/);
  });
});
