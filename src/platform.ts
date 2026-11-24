import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DomUtils, parseDocument } from "htmlparser2";
import { z } from "zod";
import { annotations, limit, PublicSource, result, SourceError } from "./source.ts";

export const name = "ai-agent-playstation-connector";
export const title = "AI Agent PlayStation Connector";
export const instructions =
  "Read PlayStation editorial game pages, public Store offers and regional PlayStation Plus monthly lineups. Cite the region, page heading and source. The lineup describes the public offer. Personal PSN authorization is unavailable in this deployment. Owned games, trophies and account playtime are unavailable.";
const region = z.enum(["en-us", "en-gb"]).default("en-us");
const slug = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const productId = z.string().regex(/^[A-Z]{2}\d{4}-[A-Z0-9]{9}_[A-Z0-9]{2}-[A-Z0-9]{16}$/);
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function install(server: McpServer, source: PublicSource) {
  server.registerTool(
    "search_games",
    {
      description:
        "Search game-page URL titles in the regional PlayStation.com editorial directory. Returns slugs for game_details.",
      annotations,
      inputSchema: { query: z.string().trim().min(1).max(100), region, limit },
    },
    ({ query, region, limit }) =>
      result(async () => {
        const sitemap = "https://www.playstation.com/" + region + "/sitemap.xml";
        const doc = parseDocument(await source.text(sitemap, 3600), { xmlMode: true });
        if (!DomUtils.getElementsByTagName("urlset", doc.children, true, 1).length)
          throw new SourceError("PlayStation's game directory format changed.");
        const prefix = "https://www.playstation.com/" + region + "/games/";
        const slugs = new Set<string>();
        for (const loc of DomUtils.getElementsByTagName("loc", doc.children)) {
          const href = DomUtils.textContent(loc);
          if (!href.startsWith(prefix) || !href.endsWith("/")) continue;
          const candidate = href.slice(prefix.length, -1);
          if (slug.safeParse(candidate).success) slugs.add(candidate);
        }
        if (!slugs.size)
          throw new SourceError("PlayStation's directory contains no recognizable game pages.");
        const words = normalize(query);
        if (!words)
          throw new SourceError("Use Latin letters or numbers from the English game title.");
        const tokens = words.split(" ");
        const matches = [...slugs]
          .map((slug) => ({ slug, key: normalize(slug) }))
          .filter((i) => tokens.every((word) => i.key.includes(word)));
        const rank = (key: string) => (key === words ? 0 : key.startsWith(words) ? 1 : 2);
        matches.sort(
          (a, b) =>
            rank(a.key) - rank(b.key) || a.key.length - b.key.length || a.key.localeCompare(b.key)
        );
        return {
          region,
          source: sitemap,
          total: matches.length,
          games: matches.slice(0, limit).map((i) => ({ slug: i.slug, url: prefix + i.slug + "/" })),
        };
      })
  );

  server.registerTool(
    "game_details",
    {
      description:
        "Read the official regional game page and extract linked PlayStation Store product IDs.",
      annotations,
      inputSchema: { slug, region },
    },
    ({ slug, region }) =>
      result(async () => {
        const page = "https://www.playstation.com/" + region + "/games/" + slug + "/";
        const doc = parseDocument(await source.text(page));
        const metas = DomUtils.getElementsByTagName("meta", doc.children);
        const meta = (key: string) =>
          metas.find((m) => m.attribs.property === key)?.attribs.content;
        const title = meta("og:title");
        if (!title) throw new SourceError("PlayStation did not return a game page for this slug.");
        const products = new Set<string>();
        const prefix = "https://store.playstation.com/" + region + "/product/";
        for (const anchor of DomUtils.getElementsByTagName("a", doc.children)) {
          const href = anchor.attribs.href;
          if (!href?.startsWith(prefix)) continue;
          const id = href.slice(prefix.length).split(/[?#/]/)[0];
          if (productId.safeParse(id).success) products.add(id);
        }
        return {
          region,
          title,
          description: meta("og:description"),
          source: page,
          products: [...products].slice(0, 20).map((id) => ({ product_id: id, url: prefix + id })),
        };
      })
  );

  server.registerTool(
    "store_offer",
    {
      description:
        "Read a regional product's published title, edition category and offer from the PlayStation Store.",
      annotations,
      inputSchema: { product_id: productId, region },
    },
    ({ product_id, region }) =>
      result(async () => {
        const page = "https://store.playstation.com/" + region + "/product/" + product_id;
        const doc = parseDocument(await source.text(page));
        const scripts = DomUtils.getElementsByTagName("script", doc.children);
        const offer = z.object({
          price: z.union([z.number(), z.string()]).optional(),
          priceCurrency: z.string().optional(),
        });
        const schema = z.object({
          "@type": z.literal("Product"),
          name: z.string(),
          sku: z.string(),
          category: z.string().optional(),
          offers: z.union([offer, z.array(offer)]).optional(),
        });
        for (const script of scripts.filter((s) => s.attribs.type === "application/ld+json")) {
          const data = schema.safeParse(JSON.parse(DomUtils.textContent(script)));
          if (data.success && data.data.sku === product_id)
            return {
              region,
              product_id,
              title: data.data.name,
              category: data.data.category,
              offers: data.data.offers === undefined ? [] : [data.data.offers].flat(),
              source: page,
            };
        }
        throw new SourceError("No matching Store product metadata was available in this region.");
      })
  );

  server.registerTool(
    "monthly_games",
    {
      description:
        "Read the monthly games named on the regional PlayStation Plus What's New page, including the publisher's period heading.",
      annotations,
      inputSchema: { region },
    },
    ({ region }) =>
      result(async () => {
        const page = "https://www.playstation.com/" + region + "/ps-plus/whats-new/";
        const doc = parseDocument(await source.text(page, 900));
        const headings = DomUtils.getElementsByTagName(
          (tag) => /^h[123]$/.test(tag),
          doc.children
        ).map((node) => ({
          tag: node.name,
          text: DomUtils.textContent(node).replace(/\s+/g, " ").trim(),
        }));
        const start = headings.findIndex((h) => h.tag === "h2" && /monthly games/i.test(h.text));
        const titles = new Set<string>();
        if (start >= 0) {
          for (const heading of headings.slice(start + 1)) {
            if (heading.tag !== "h3") break;
            if (heading.text) titles.add(heading.text);
          }
        }
        if (!titles.size)
          throw new SourceError(
            "PlayStation has no recognizable monthly games section for this region."
          );
        return {
          region,
          period_heading: headings.find((h) => h.tag === "h1")?.text,
          games: [...titles],
          source: page,
        };
      })
  );
}
