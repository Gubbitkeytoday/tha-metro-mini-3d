import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UI_LANGUAGES } from "../src/i18n/strings.ts";

/**
 * Static checks on the discoverability surface.
 *
 * These are unit tests rather than a browser run because every one of them is
 * a property of files on disk, and because the failure they guard against is
 * silent: a stale hreflang list or a sitemap that has drifted from the app's
 * real languages costs nothing at runtime and quietly wastes crawl budget for
 * months. Cheap to assert, invisible otherwise.
 */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
);

const SITE = "https://metro.itstom.me";

describe("index.html metadata", () => {
  it("has a descriptive title and description", () => {
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? "";
    expect(title.length).toBeGreaterThan(30);
    expect(title.length).toBeLessThan(120);
    const description = /<meta\s+name="description"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    // Long enough to be useful in a result, short enough not to be truncated
    // into nonsense.
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThan(340);
  });

  it("declares a canonical URL", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
  });

  it("lets crawlers in", () => {
    const robotsMeta = /<meta\s+name="robots"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(robotsMeta).toContain("index");
    expect(robotsMeta).toContain("follow");
    expect(robotsMeta).not.toContain("noindex");
  });

  it("has complete Open Graph and Twitter cards", () => {
    for (const property of [
      "og:type",
      "og:url",
      "og:title",
      "og:description",
      "og:image",
      "og:image:alt",
    ]) {
      expect(html).toContain(`property="${property}"`);
    }
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:image"');
  });

  it("links every UI language as an hreflang alternate, plus x-default", () => {
    for (const lang of UI_LANGUAGES) {
      expect(html).toContain(`hreflang="${lang}" href="${SITE}/?lang=${lang}"`);
    }
    expect(html).toContain('hreflang="x-default"');
  });

  it("ships crawlable text, not just an empty root div", () => {
    const root = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? "";
    // A canvas app is invisible to a non-rendering crawler without this.
    expect(root).toContain("<h1>");
    expect(root.replace(/<[^>]+>/g, " ").trim().length).toBeGreaterThan(400);
  });

  it("names every simulated line in the prerendered text", () => {
    for (const line of [
      "Sukhumvit",
      "Silom",
      "Gold",
      "MRT Blue",
      "MRT Purple",
      "MRT Pink",
      "MRT Yellow",
      "Dark Red",
      "Light Red",
      "Airport Rail Link",
    ]) {
      expect(html).toContain(line);
    }
  });

  it("tells a non-JS visitor what they need", () => {
    expect(html).toContain("<noscript>");
    expect(html).toMatch(/noscript[\s\S]*JavaScript/);
  });
});

describe("structured data", () => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  it("is present and valid JSON", () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, body] of blocks) expect(() => JSON.parse(body)).not.toThrow();
  });

  it("describes the app honestly", () => {
    const graph = JSON.parse(blocks[0][1])["@graph"];
    const app = graph.find((n) => n["@type"] === "WebApplication");
    expect(app).toBeTruthy();
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers.price).toBe("0");
    // The app really is free and really does run in a browser — claiming a
    // rating or a review count we do not have would be structured-data spam.
    expect(app.aggregateRating).toBeUndefined();
    expect(app.review).toBeUndefined();
    expect(app.inLanguage).toEqual(expect.arrayContaining(["en", "th"]));
  });

  it("credits the source datasets", () => {
    const graph = JSON.parse(blocks[0][1])["@graph"];
    const dataset = graph.find((n) => n["@type"] === "Dataset");
    expect(dataset).toBeTruthy();
    expect(dataset.isBasedOn.join(" ")).toContain("openstreetmap");
    expect(dataset.isBasedOn.join(" ")).toContain("namtang");
  });

  it("answers the question this app is most likely to be misread on", () => {
    const graph = JSON.parse(blocks[0][1])["@graph"];
    const faq = graph.find((n) => n["@type"] === "FAQPage");
    expect(faq).toBeTruthy();
    const text = JSON.stringify(faq);
    // "Is this real-time?" — it is not, and the markup must say so.
    expect(text).toMatch(/real-time/i);
    expect(text).toMatch(/schedule simulation/i);
  });
});

describe("robots.txt", () => {
  it("allows crawling and points at the sitemap", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("keeps crawlers out of the binary build artefacts", () => {
    expect(robots).toContain("Disallow: /data/");
  });
});

describe("sitemap.xml", () => {
  it("lists the site with a language alternate for each UI language", () => {
    expect(sitemap).toContain(`<loc>${SITE}/</loc>`);
    for (const lang of UI_LANGUAGES) {
      expect(sitemap).toContain(`hreflang="${lang}" href="${SITE}/?lang=${lang}"`);
    }
    expect(sitemap).toContain('hreflang="x-default"');
  });
});

describe("web app manifest", () => {
  it("is installable", () => {
    expect(manifest.name).toBeTruthy();
    // Home-screen labels truncate around a dozen characters.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("provides a maskable icon so Android does not letterbox it", () => {
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
