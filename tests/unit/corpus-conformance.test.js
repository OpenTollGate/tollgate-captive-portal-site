import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

vi.mock("nostr-tools", () => ({
  getPublicKey: () => "1".repeat(64),
  getEventHash: () => "2".repeat(64),
  getSignature: () => "3".repeat(128),
}));

import { validateToken, submitToken } from "../../src/helpers/cashu.js";
import { getTollgateBaseUrl } from "../../src/helpers/tollgate.js";

const i18n = (key, fallback) => fallback || key;

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "corpus"
);
const fixture = (name) =>
  readFileSync(path.join(fixtureDir, `${name}.cashu`), "utf8").trim();

// The mint the corpus fixtures were minted for (cdk-mintd 0.18.1
// fakewallet, V2 keyset 01e73e75…e6). Mirrors how the app passes the
// advertisement-selected mint into validateToken.
const corpusMint = { url: "http://192.168.13.221:8383", unit: "sat" };

// Conformance vectors from the TollGate protocol repo's token corpus
// (v1, OpenTollGate/tollgate#30). The v0.6.0 browser e-cash incident
// (portal#82 / PRTA#247 / tmbg#952) was this exact surface diverging:
// the decoder rejected V2-keyset tokens client-side and the payment
// was never submitted. These tests make that class of regression
// impossible to reintroduce silently.
describe("token corpus decode conformance", () => {
  it.each([
    ["v4_v2_kg181", 4, 1],
    ["v3_v2_kg181", 4, 1],
    ["v3_v2_full66", 4, 1],
    ["v3_v2_valid", 4, 2],
    ["v4_v2_valid", 4, 2],
  ])("accepts %s (V2-keyset era, cdk-minted)", (name, amount, proofCount) => {
    const result = validateToken(fixture(name), corpusMint, i18n);
    expect(result.status).toBe(1);
    expect(result.value.amount).toBe(amount);
    expect(result.value.proofCount).toBe(proofCount);
    expect(result.value.unit).toBe("sat");
  });

  it("decodes the truncated-16-hex-id regression shape (PRTA#247)", () => {
    // The backend resolves the 16-hex prefix to the canonical V2 keyset
    // id and accepts (kind 1022); the portal decoder must not reject
    // what the reference stack redeems.
    const result = validateToken(fixture("v3_v2_truncated_id"), corpusMint, i18n);
    expect(result.status).toBe(1);
    expect(result.value.amount).toBe(4);
    expect(result.value.proofCount).toBe(1);
  });

  it("decodes the hex-C shape and defers the verdict to the backend", () => {
    // CU102-class shape (C bytes are not a point — a v0 corpus regen
    // artifact): the corpus records the authoritative rejection at the
    // merchant (kind 21023 payment-processing-failed). The portal's contract is
    // decode + submit; C-point validation is the backend's job, so the
    // decode must not strand the user client-side.
    const result = validateToken(fixture("v3_v2_hex_c"), corpusMint, i18n);
    expect(result.status).toBe(1);
    expect(result.value.amount).toBe(4);
    expect(result.value.proofCount).toBe(2);
  });
});

// portal#82's packet capture: 7x GET /, 7x /ln-invoice, 7x /whoami —
// and 0x POST /. A decode-passing token that does not reach POST / is
// the browser e-cash payment outage, verbatim.
describe("submit wire conformance (HTTP-01 POST /)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["v3_v2_kg181", "v4_v2_kg181"])(
    "POSTs %s as a raw text/plain body to the tollgate root",
    async (name) => {
      const token = fixture(name);
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await submitToken(token, { detailsEvent: { pubkey: "0".repeat(64) } }, "30m", i18n);

      expect(result.status).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${getTollgateBaseUrl()}/`);
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("text/plain");
      expect(init.body).toBe(token);
    }
  );
});
