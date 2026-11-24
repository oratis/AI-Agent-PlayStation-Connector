import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handler } from "../src/index.ts";
import { name } from "../src/platform.ts";

export async function withClient(upstream: typeof fetch, run: (client: Client) => Promise<void>) {
  const serve = handler(upstream);
  const client = new Client({ name: "test-client", version: "1" });
  const endpoint = new URL("https://test.invalid/mcp");
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: (url, init) => serve(new Request(url, init)),
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, name);
    await run(client);
  } finally {
    await client.close();
  }
}

test("remote SDK client negotiates and discovers read-only tools without platform calls", async () => {
  await withClient(
    () => {
      throw new Error("unexpected fetch");
    },
    async (client) => {
      const { tools } = await client.listTools();
      assert.ok(tools.length >= 3);
      assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
    }
  );
});

test("HTTP routing rejects foreign origins and does not open idle streams", async () => {
  const serve = handler(fetch);
  const endpoint = "https://test.invalid/mcp";
  assert.equal(
    (
      await serve(
        new Request(endpoint, { method: "POST", headers: { origin: "https://other.invalid" } })
      )
    ).status,
    403
  );
  assert.equal((await serve(new Request(endpoint))).status, 405);
  assert.equal((await serve(new Request(endpoint + "/bad"))).status, 404);
});

test("invalid arguments are rejected before querying the platform", async () => {
  let calls = 0;
  await withClient(
    async () => {
      calls++;
      return new Response();
    },
    async (client) => {
      const response = await client.callTool({
        name: "game_details",
        arguments: { slug: "../../bad" },
      });
      assert.equal(response.isError, true);
      assert.equal(calls, 0);
    }
  );
});

test("upstream throttling is actionable and does not echo the body", async () => {
  await withClient(
    async () => new Response("debug details", { status: 429 }),
    async (client) => {
      const response = await client.callTool({
        name: "game_details",
        arguments: { slug: "astro-bot" },
      });
      assert.equal(response.isError, true);
      const text = JSON.stringify(response.content);
      assert.match(text, /429/);
      assert.doesNotMatch(text, /debug details/);
    }
  );
});

test("editorial directory ranks exact slugs and omits nested and off-site pages", async () => {
  const base = "https://www.playstation.com/en-us/games/";
  const urls = [
    base + "astro-bot/guide/",
    base + "astro-bot-rescue-mission/",
    base + "astro-bot/",
    "https://another.invalid/astro-bot/",
  ];
  const xml =
    "<urlset>" + urls.map((u) => "<url><loc>" + u + "</loc></url>").join("") + "</urlset>";
  await withClient(
    async () => new Response(xml),
    async (client) => {
      const response = await client.callTool({
        name: "search_games",
        arguments: { query: "Astro Bot" },
      });
      assert.deepEqual(response.structuredContent?.games, [
        { slug: "astro-bot", url: base + "astro-bot/" },
        { slug: "astro-bot-rescue-mission", url: base + "astro-bot-rescue-mission/" },
      ]);
    }
  );
});

test("monthly lineup stops at the next section and keeps the publisher's heading", async () => {
  const html =
    "<h1>November on Plus</h1><h2>Game Catalogue</h2><h3>Catalogue title</h3><h2>Your latest monthly games</h2><h3>Monthly title</h3><h2>Trials</h2><h3>Trial title</h3>";
  await withClient(
    async () => new Response(html),
    async (client) => {
      const response = await client.callTool({
        name: "monthly_games",
        arguments: { region: "en-gb" },
      });
      assert.deepEqual(response.structuredContent?.games, ["Monthly title"]);
      assert.equal(response.structuredContent?.period_heading, "November on Plus");
    }
  );
});
