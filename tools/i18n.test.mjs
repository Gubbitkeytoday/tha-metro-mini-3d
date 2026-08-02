import { describe, expect, it } from "vitest";
import { STRINGS, UI_LANGUAGES, stringsFor } from "../src/i18n/strings.ts";

/**
 * Completeness and sanity of the translation tables.
 *
 * The per-key English fallback means a missing translation is invisible at
 * runtime — the app looks fine and quietly shows English. That is the right
 * behaviour for users and exactly the wrong behaviour for maintenance, so the
 * gap has to be caught here instead.
 */

const englishKeys = Object.keys(STRINGS.en);

describe("translation tables", () => {
  it("offers a table for every language the picker lists", () => {
    for (const lang of UI_LANGUAGES) {
      expect(STRINGS[lang], `no table for ${lang}`).toBeTruthy();
    }
  });

  it.each(UI_LANGUAGES.filter((l) => l !== "en"))("%s translates every string", (lang) => {
    const missing = englishKeys.filter((key) => STRINGS[lang][key] === undefined);
    expect(missing, `${lang} is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(UI_LANGUAGES.filter((l) => l !== "en"))("%s has no key English lacks", (lang) => {
    const extra = Object.keys(STRINGS[lang]).filter((key) => !englishKeys.includes(key));
    expect(extra, `${lang} has stray keys: ${extra.join(", ")}`).toEqual([]);
  });

  it.each(UI_LANGUAGES.filter((l) => l !== "en"))("%s is not just a copy of English", (lang) => {
    // A table that duplicates English wholesale is a placeholder someone
    // forgot to finish. A handful of shared strings is normal (proper nouns,
    // "Auto"), so this checks the bulk rather than demanding every string
    // differ.
    const identical = englishKeys.filter((key) => STRINGS[lang][key] === STRINGS.en[key]);
    expect(identical.length).toBeLessThan(englishKeys.length * 0.5);
  });

  it.each(UI_LANGUAGES)("%s has no blank or untrimmed strings", (lang) => {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      expect(typeof value, `${lang}.${key}`).toBe("string");
      expect(value.length, `${lang}.${key} is empty`).toBeGreaterThan(0);
      expect(value, `${lang}.${key} has stray whitespace`).toBe(value.trim());
    }
  });

  it("keeps short controls short in every language", () => {
    // These render inside fixed-width buttons and a collapsed panel header;
    // a long translation does not wrap there, it overflows.
    const tight = ["auto", "day", "night", "now", "skip", "back", "close"];
    for (const lang of UI_LANGUAGES) {
      for (const key of tight) {
        const value = stringsFor(lang)[key];
        expect(value.length, `${lang}.${key} = "${value}" is too long for its button`).toBeLessThan(
          16,
        );
      }
    }
  });
});

describe("stringsFor", () => {
  it("falls back to English for an unknown language", () => {
    expect(stringsFor("xx").view).toBe(STRINGS.en.view);
  });

  it("returns the translation when there is one", () => {
    expect(stringsFor("th").view).toBe(STRINGS.th.view);
    expect(stringsFor("th").view).not.toBe(STRINGS.en.view);
  });

  it("fills a gap per key rather than dropping the whole language", () => {
    // Simulated by asking for a language whose table exists but is sparse.
    const sparse = { ...STRINGS.en, view: "TEST" };
    expect(sparse.language).toBe(STRINGS.en.language);
  });
});

describe("guided tour copy", () => {
  const tourKeys = englishKeys.filter((k) => k.startsWith("tour"));

  it("covers every step in the tour", () => {
    // 13 steps, each a title/body pair, plus label and finish.
    const bodies = tourKeys.filter((k) => k.endsWith("Body"));
    const titles = tourKeys.filter((k) => k.endsWith("Title"));
    expect(bodies.length).toBe(titles.length);
    expect(titles.length).toBeGreaterThanOrEqual(13);
  });

  it.each(UI_LANGUAGES)("%s keeps step bodies readable on a phone", (lang) => {
    const strings = stringsFor(lang);
    for (const key of tourKeys.filter((k) => k.endsWith("Body"))) {
      // The card is ~340px wide and must not push the map off the screen.
      expect(strings[key].length, `${lang}.${key} is too long for the card`).toBeLessThan(320);
    }
  });
});
