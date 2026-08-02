#!/usr/bin/env node
/**
 * Render the PromptPay payload to `public/promptpay-qr.svg`.
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
 * Usage: npm run promptpay:qr
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { formatMobile, promptPayPayload } from "../src/lib/promptpay.ts";
import { SUPPORT } from "../src/config/support.ts";

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

const svg = await QRCode.toString(payload, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2,
  color: { dark: "#0f172aff", light: "#ffffffff" },
});

const out = resolve(repo, "public/promptpay-qr.svg");
writeFileSync(out, svg);
console.log(`wrote ${out}`);
console.log(`account: ${formatMobile(mobile)}`);
console.log(`payload: ${payload}`);
