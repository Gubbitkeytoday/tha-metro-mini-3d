/**
 * PromptPay payload construction (EMVCo merchant-presented QR).
 *
 * This file exists because a payment QR is the one piece of this app where a
 * wrong byte moves real money to the wrong person. So the payload is built
 * from the spec here, in one small pure function, and unit-tested against a
 * known-good string — rather than assembled inline next to some JSX where a
 * later edit could quietly change a digit.
 *
 * The QR itself is **not** drawn at runtime. `npm run qr` renders
 * this payload to `public/promptpay-qr.svg` at build time and that file is
 * committed, so the code a visitor scans is a reviewable artefact in the
 * repository rather than something the page computed on the fly. The account
 * number is always printed next to it so anyone can check the QR against the
 * digits before paying.
 *
 * Format (EMVCo + Thai Bankers' Association PromptPay profile):
 *
 * ```
 * 00 02 01                     payload format indicator
 * 01 02 11                     point of initiation: 11 static, 12 dynamic
 * 29 37                        merchant account information (PromptPay)
 *    00 16 A000000677010111    application id
 *    01 13 0066XXXXXXXXX       mobile number, +66 form
 * 53 03 764                    currency: THB (ISO 4217)
 * 58 02 TH                     country
 * 63 04 XXXX                   CRC-16/CCITT-FALSE over everything before it
 * ```
 *
 * Deliberately **static only** — no amount (tag 54) and no reference fields.
 * A static code lets the payer type the amount they intended; an amount baked
 * into a donation QR is the kind of surprise that makes people close the app.
 */

/** Thai Bankers' Association application id for PromptPay. */
const PROMPTPAY_AID = "A000000677010111";
const TAG_MOBILE = "01";

/** `id` + zero-padded two-digit length + value. */
function field(id: string, value: string): string {
  const length = value.length.toString().padStart(2, "0");
  if (value.length > 99) throw new Error(`promptpay: field ${id} is too long`);
  return `${id}${length}${value}`;
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection,
 * no final XOR. This exact variant is what the spec requires; the several
 * other "CRC-16"s produce a checksum every banking app will reject.
 */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * A Thai mobile number in the `0066…` form PromptPay expects.
 *
 * Throws rather than guessing. A mobile PromptPay id is exactly ten digits
 * starting with 0, and silently accepting eleven — then truncating, or
 * padding — is how a QR ends up addressing somebody else's wallet.
 */
export function normaliseMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10 || !digits.startsWith("0")) {
    throw new Error(
      `promptpay: "${raw}" is not a Thai mobile number — expected 10 digits starting with 0, got ${digits.length}`,
    );
  }
  return `0066${digits.slice(1)}`;
}

/** Format a 10-digit mobile number as `0XX-XXX-XXXX` for display. */
export function formatMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * The full static PromptPay payload for a mobile-number account.
 *
 * The CRC is computed over the payload *including* the `6304` tag and length
 * but excluding the checksum itself — a detail that is easy to get wrong and
 * is why `crc16` is called on a string that already ends in "6304".
 */
export function promptPayPayload(mobile: string): string {
  const account = field("29", field("00", PROMPTPAY_AID) + field(TAG_MOBILE, normaliseMobile(mobile)));
  const body =
    field("00", "01") + field("01", "11") + account + field("53", "764") + field("58", "TH");
  return `${body}6304${crc16(`${body}6304`)}`;
}
