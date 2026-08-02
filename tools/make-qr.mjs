#!/usr/bin/env node
/**
 * Render the project's QR codes into `public/`.
 *
 * Two of them, and only two, because only two can be made to work honestly:
 *
 * - `promptpay-qr.svg` — the PromptPay payment code. It is also the TrueMoney
 *   code: TrueMoney Wallet scans PromptPay, so a separate "TrueMoney QR" would
 *   either be a byte-identical duplicate presented as something different, or a
 *   deep link nobody here can verify. One code labelled for both is the honest
 *   version.
 * - `share-qr.svg` — the site URL. Scanning it opens the app, which is the one
 *   case where "scan it and it tells you what it is" is literally true.
 *
 * There is deliberately **no QR for the bank account**. PromptPay resolves a
 * registered identifier to an account and is not addressed by account number;
 * the EMVCo bank-account tag exists but is inconsistently supported by Thai
 * banking apps, so such a code would fail to resolve for some payers. A payment
 * QR that works for only some people is worse than none.
 *
 * Build time, not run time, and the result is committed. Three reasons:
 *
 * 1. **It is auditable.** The scannable code becomes a file in the repository
 *    that a reviewer can decode, instead of bytes the page assembled on the
 *    fly. Anyone can check it against the printed digits.
 * 2. **`qrcode` stays a devDependency.** No QR encoder ships to the browser,
 *    so the 5 MB bundle budget (NF2) pays nothing for this.
 * 3. **The payload is static.** No amount, no reference — the code never
 *    changes, so there is nothing to generate per visitor.
 *
 * The payload comes from `src/lib/promptpay.ts` — the same module the app and
 * its unit tests use, imported directly. Node 22.6+ strips TypeScript types on
 * import, and both modules are dependency-free and type-annotation-only, so no
 * build step is involved. Reimplementing the builder here would give the
 * project two places where a payment destination is assembled, which is
 * exactly one too many. (Node 24 enables stripping by default; on an older
 * Node run it with `--experimental-strip-types`.)
 *
 * Error correction is M: a donation code is scanned off a screen at close
 * range, where H's extra redundancy only costs module density, and so
 * legibility, for no real gain.
 *
 * Usage: npm run qr
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { formatMobile, promptPayPayload } from "../src/lib/promptpay.ts";
import { SITE_URL, SUPPORT } from "../src/config/support.ts";

const repo = resolve(import.meta.dirname, "..");

const mobile = process.argv[2] ?? SUPPORT.promptPayId;
if (!mobile) {
  console.error(
    "no PromptPay id: set SUPPORT.promptPayId in src/config/support.ts, or pass one as an argument",
  );
  process.exit(1);
}

// Throws on anything that is not a real ten-digit Thai mobile number. A QR
// that encodes the wrong account is worse than no QR at all, so this must stay
// a hard failure and never fall back to "close enough".
const payload = promptPayPayload(mobile);

/**
 * Both codes are plain dark-on-white with square modules and no centre logo.
 *
 * The visual identity lives in the card that frames them in the UI, not in the
 * code itself: a logo punched into the middle eats error-correction budget, and
 * coloured or rounded modules cost contrast — both of which are paid for in scan
 * failures on a cheap phone camera in bad light, which is exactly when someone
 * is trying to scan.
 *
 * Error correction Q rather than M for the payment code: it is the one that has
 * to work first time, possibly off a smudged screen at an angle.
 */
async function render(payload, file, errorCorrectionLevel) {
  const svg = await QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel,
    margin: 2,
    color: { dark: "#0f172aff", light: "#ffffffff" },
  });
  const out = resolve(repo, "public", file);
  writeFileSync(out, svg);
  console.log(`wrote public/${file}`);
  return out;
}

await render(payload, "promptpay-qr.svg", "Q");
console.log(`  account: ${formatMobile(mobile)}`);
console.log(`  payload: ${payload}`);

await render(SITE_URL, "share-qr.svg", "M");
console.log(`  url: ${SITE_URL}`);
