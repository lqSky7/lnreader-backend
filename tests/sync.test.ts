import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupIntegration, signUpTestUser } from "./helpers.js";

const { client } = setupIntegration();

const IOS_SHAPED_LIBRARY = [
  {
    path: "novel/shadow-slave",
    pluginId: "novelphoenix",
    name: "Shadow Slave",
    cover: "https://example.com/cover.jpg",
    summary: "A novel.",
    author: "Guiltythree",
    artist: null,
    status: "Ongoing",
    genres: "Action, Fantasy",
    inLibrary: true,
    totalPages: 1,
    libraryPosition: 0,
    chapters: [
      {
        path: "novel/shadow-slave/chapter-1",
        name: "Chapter 1",
        releaseTime: null,
        bookmark: false,
        unread: false,
        isDownloaded: false,
        chapterNumber: 1,
        page: "1",
        position: 0,
        progress: 50,
      },
    ],
  },
];

const SOURCES = [
  {
    id: "novelphoenix",
    name: "Novel Phoenix",
    site: "https://novelphoenix.com/",
    lang: "English",
    version: "1.0.2",
    url: "https://example.com/p.js",
    iconUrl: "https://example.com/i.png",
  },
];

describe("sync endpoints", () => {
  it("rejects invalid payloads with 400 + details", async () => {
    const c = client();
    await signUpTestUser(c);
    const res = await c.req("PUT", "/api/sync", { profile: "nope", library: {} });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error: string }).error, "Invalid sync payload");
  });

  it("round-trips the exact iOS payload shape", async () => {
    const c = client();
    await signUpTestUser(c);
    const put = await c.req("PUT", "/api/sync", {
      profile: { username: "tester", email: "tester@example.com", name: "Tester", image: null },
      library: IOS_SHAPED_LIBRARY,
      sources: SOURCES,
    });
    assert.equal(put.status, 200);
    assert.ok((put.json as { updatedAt: string }).updatedAt);

    const get = await c.req("GET", "/api/sync");
    assert.equal(get.status, 200);
    const data = (get.json as { data: { profile: unknown; library: unknown[]; sources: unknown[]; updatedAt: string } }).data;
    assert.deepEqual(data.profile, { username: "tester", email: "tester@example.com", name: "Tester", image: null });
    assert.equal(data.library.length, 1);
    assert.equal((data.library[0] as { name: string }).name, "Shadow Slave");
    assert.equal(data.sources.length, 1);
    assert.ok(data.updatedAt);
  });

  it("GET /api/sync/meta returns the timestamp without the payload", async () => {
    const c = client();
    await signUpTestUser(c);
    const empty = await c.req("GET", "/api/sync/meta");
    assert.deepEqual(empty.json, { updatedAt: null });

    await c.req("PUT", "/api/sync", { profile: {}, library: [], sources: [] });
    const meta = await c.req("GET", "/api/sync/meta");
    assert.equal(meta.status, 200);
    assert.ok((meta.json as { updatedAt: string }).updatedAt);
  });

  it("GET /api/sync/export downloads the same data as an attachment", async () => {
    const c = client();
    await signUpTestUser(c);
    await c.req("PUT", "/api/sync", { profile: {}, library: IOS_SHAPED_LIBRARY, sources: [] });
    const res = await c.req("GET", "/api/sync/export");
    assert.equal(res.status, 200);
    const disp = res.headers.get("content-disposition") ?? "";
    assert.ok(disp.startsWith("attachment;"), `expected attachment, got ${disp}`);
    const body = res.json as { exportedAt: string; data: { library: unknown[] } };
    assert.ok(body.exportedAt);
    assert.equal(body.data.library.length, 1);
  });

  it("rejects stale writes with 409 and returns the server copy", async () => {
    const c = client();
    await signUpTestUser(c);
    const first = await c.req("PUT", "/api/sync", { profile: { name: "v1" }, library: [], sources: [] });
    const serverTime = (first.json as { updatedAt: string }).updatedAt;

    // A device holding data from long ago must not clobber the server.
    const stale = await c.req("PUT", "/api/sync", {
      profile: { name: "stale" },
      library: [],
      sources: [],
      clientUpdatedAt: new Date(Date.parse(serverTime) - 60_000).toISOString(),
    });
    assert.equal(stale.status, 409);
    const staleBody = stale.json as { error: string; serverUpdatedAt: string; data: { profile: { name: string } } };
    assert.match(staleBody.error, /conflict/i);
    assert.equal(staleBody.serverUpdatedAt, serverTime);
    assert.equal(staleBody.data.profile.name, "v1");

    // A fresh timestamp goes through.
    const fresh = await c.req("PUT", "/api/sync", {
      profile: { name: "v2" },
      library: [],
      sources: [],
      clientUpdatedAt: new Date().toISOString(),
    });
    assert.equal(fresh.status, 200);

    const get = await c.req("GET", "/api/sync");
    assert.equal(((get.json as { data: { profile: { name: string } } }).data.profile.name), "v2");
  });

  it("omitting clientUpdatedAt keeps legacy last-write-wins behaviour", async () => {
    const c = client();
    await signUpTestUser(c);
    await c.req("PUT", "/api/sync", { profile: { name: "a" }, library: [], sources: [] });
    const res = await c.req("PUT", "/api/sync", { profile: { name: "b" }, library: [], sources: [] });
    assert.equal(res.status, 200);
  });
});
