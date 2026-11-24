import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = new URL(
  process.argv[2] ?? "https://playstation-mcp.oratisoratisoratisoratis.workers.dev/mcp"
);
const client = new Client({ name: "connector-smoke", version: "1" });

async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, name + " failed: " + JSON.stringify(response.content));
  assert.ok(response.structuredContent, name + " returned no structured data");
  console.log("OK", name);
  return response.structuredContent;
}

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  assert.equal(client.getServerVersion()?.name, "playstation-mcp");
  const { tools } = await client.listTools();
  console.log(endpoint.href, tools.map((t) => t.name).join(", "));
  const list = await call("search_games", { query: "astro bot" });
  assert.equal(list.games[0].slug, "astro-bot");
  const game = await call("game_details", { slug: list.games[0].slug });
  assert.ok(game.products.length);
  const offer = await call("store_offer", { product_id: game.products[0].product_id });
  assert.match(offer.title, /astro bot/i);
  assert.ok(offer.offers.some((o) => o.priceCurrency === "USD"));
  const monthly = await call("monthly_games", {});
  assert.ok(monthly.games.length > 0 && monthly.period_heading);
} finally {
  await client.close();
}
