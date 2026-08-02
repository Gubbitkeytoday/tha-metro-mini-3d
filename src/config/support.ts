/**
 * Where "support this project" points.
 *
 * ## Fill these in before deploying
 *
 * These are deliberately **empty by default and the UI hides itself when they
 * are**. A donation destination is an account only the project's owner can
 * supply: guessing one, or pointing it at somebody else's page, would send
 * real money to the wrong person. So nothing is invented here — add your own
 * links and the Support button appears.
 *
 * Any subset works; only the ones you fill in are shown.
 *
 * - `githubSponsors` — e.g. "https://github.com/sponsors/yourname"
 * - `kofi` — e.g. "https://ko-fi.com/yourname"
 * - `buyMeACoffee` — e.g. "https://buymeacoffee.com/yourname"
 * - `promptPayId` — a Thai PromptPay mobile number (ten digits). Shown as
 *   text to copy, next to a QR.
 *
 *   The QR is **not drawn by the page**. `npm run promptpay:qr` renders it from
 *   `src/lib/promptpay.ts` into `public/promptpay-qr.svg`, which is committed:
 *   the code people scan is then a reviewable file in the repository, and the
 *   digits are always printed beside it so a payer can check one against the
 *   other. A QR a page computes at runtime is indistinguishable from one an
 *   attacker swapped in, and there is no reason to compute this one — a static
 *   PromptPay payload carries no amount and never changes.
 *
 *   Re-run `npm run promptpay:qr` after changing this value, or the committed
 *   SVG still points at the old account. `tools/support.test.mjs` fails if the
 *   two ever disagree.
 * - `trueMoneyId` — a TrueMoney Wallet mobile number, shown as text. TrueMoney
 *   also scans PromptPay codes, so the QR above works for it too.
 * - `custom` — any other page, with your own label.
 *
 * ## Why the UI is shaped the way it is
 *
 * The brief was "support, but not annoying". That rules out the usual
 * patterns: no modal on arrival, no timed pop-up, no banner pinned over the
 * map, no nagging after N visits. What is left is a quiet entry in the About
 * panel and one line at the end of the guided tour — both places a visitor has
 * already chosen to look at. If it is ever shown anywhere else, it has stopped
 * meeting the brief.
 */

export interface SupportLinks {
  githubSponsors?: string;
  kofi?: string;
  buyMeACoffee?: string;
  promptPayId?: string;
  trueMoneyId?: string;
  custom?: { label: string; url: string };
}

export const SUPPORT: SupportLinks = {
  promptPayId: "0958462520",
  trueMoneyId: "0958462520",
  // githubSponsors: "https://github.com/sponsors/yourname",
  // kofi: "https://ko-fi.com/yourname",
};

/**
 * The committed QR for `SUPPORT.promptPayId`, or null when there is none.
 *
 * A path rather than an inline data URI so the browser caches it and so the
 * file stays independently viewable — being able to open the exact image that
 * is served, on its own, is part of what makes it checkable.
 */
export const PROMPTPAY_QR_SRC: string | null = SUPPORT.promptPayId
  ? "/promptpay-qr.svg"
  : null;

/** The project's own home, always safe to show — it is not a payment link. */
export const PROJECT_LINKS = {
  repository: "https://github.com/naiiytom/tha-metro-mini-3d",
  issues: "https://github.com/naiiytom/tha-metro-mini-3d/issues",
};

/** True when at least one support destination has been configured. */
export function hasSupportLinks(links: SupportLinks = SUPPORT): boolean {
  return Boolean(
    links.githubSponsors ||
      links.kofi ||
      links.buyMeACoffee ||
      links.promptPayId ||
      links.trueMoneyId ||
      links.custom,
  );
}
