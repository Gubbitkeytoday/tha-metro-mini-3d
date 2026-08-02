import { describe, expect, it } from "vitest";
import { crc16, formatMobile, normaliseMobile, promptPayPayload } from "./promptpay";

describe("crc16", () => {
  it("matches the CRC-16/CCITT-FALSE check value", () => {
    // The standard check vector for this variant. Getting a different answer
    // here means a different CRC-16 was implemented, and every banking app
    // will reject the payload.
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("normaliseMobile", () => {
  it("converts a Thai mobile number to the 0066 form", () => {
    expect(normaliseMobile("0958462520")).toBe("0066958462520");
    expect(normaliseMobile("095-846-2520")).toBe("0066958462520");
  });

  it("refuses a number that is not ten digits rather than guessing", () => {
    // This is the whole point of the module: an eleven-digit number silently
    // truncated or padded is a QR that addresses someone else's wallet.
    expect(() => normaliseMobile("09584625202")).toThrow(/10 digits/);
    expect(() => normaliseMobile("958462520")).toThrow(/10 digits/);
    expect(() => normaliseMobile("6958462520")).toThrow(/starting with 0/);
  });
});

describe("formatMobile", () => {
  it("groups the digits the way a Thai number is written", () => {
    expect(formatMobile("0958462520")).toBe("095-846-2520");
  });

  it("leaves anything else alone rather than mangling it", () => {
    expect(formatMobile("1234")).toBe("1234");
  });
});

describe("promptPayPayload", () => {
  const payload = promptPayPayload("0958462520");

  it("is a static merchant-presented payload", () => {
    expect(payload.startsWith("00020101021129")).toBe(true);
  });

  it("carries the PromptPay application id and the account in 0066 form", () => {
    expect(payload).toContain("0016A000000677010111");
    expect(payload).toContain("01130066958462520");
  });

  it("declares Thai baht and Thailand", () => {
    expect(payload).toContain("5303764");
    expect(payload).toContain("5802TH");
  });

  it("carries no amount, so the payer chooses it", () => {
    // Tag 54 is the transaction amount. A donation QR that dictates one is a
    // surprise, and this asserts we never accidentally add it.
    expect(/54\d\d/.test(payload.slice(0, -8))).toBe(false);
  });

  it("ends with a checksum computed over everything before it", () => {
    const body = payload.slice(0, -4);
    expect(body.endsWith("6304")).toBe(true);
    expect(payload.slice(-4)).toBe(crc16(body));
  });

  it("is the exact expected string", () => {
    // Pinned so any future edit to the builder has to be deliberate.
    expect(payload).toBe(
      "00020101021129370016A0000006770101110113006695846252053037645802TH63042E0B",
    );
  });
});
