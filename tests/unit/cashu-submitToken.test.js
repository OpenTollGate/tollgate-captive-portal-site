import { describe, it, expect, vi, afterEach } from "vitest";

// Mock nostr-tools crypto so we can drive submitToken straight to the
// fetch/error-parsing path without real key generation (nostr-tools'
// signing throws on jsdom without a proper Uint8Array env).
vi.mock("nostr-tools", () => ({
  getPublicKey: () => "1".repeat(64),
  getEventHash: (e) => "2".repeat(64),
  getSignature: () => "3".repeat(128),
}));

import { getEncodedToken } from "@cashu/cashu-ts";
import { submitToken, validateToken, canSubmitAnyway } from "../../src/helpers/cashu.js";

// i18n stub mirrors the app's i18next usage: return key, or interpolated value
const i18n = (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key);

// minimal detailsEvent; submitToken only reads .pubkey
const tollgateDetails = {
  detailsEvent: { pubkey: "0".repeat(64) },
};

describe("submitToken backend error parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a DLEQ keyset-rotation backend error (kind 21023) to CU109", async () => {
    const errorBody = {
      kind: 21023,
      content: "keyset rotated",
      tags: [
        ["p", "0".repeat(64)],
        ["code", "payment-error-dleq-keyset-rotation"],
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        clone: () => ({ json: async () => errorBody }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU109");
    expect(result.label).toBe("CU109_label");
    expect(result.message).toBe("CU109_message");
  });

  it("surfaces the backend content message for generic payment errors", async () => {
    const errorBody = {
      kind: 21023,
      content: "token already spent",
      tags: [
        ["p", "0".repeat(64)],
        ["code", "payment-error-token-spent"],
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        clone: () => ({ json: async () => errorBody }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU106");
    expect(result.message).toBe("token already spent");
  });

  it("falls back to generic CU106 when the body is not a parseable kind 21023", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        clone: () => ({
          json: async () => {
            throw new Error("not json");
          },
        }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU106");
    expect(result.message).toBe("CU106_message");
  });

  it("keeps CU107 semantics for a non-402 server error even with a parseable 21023 body", async () => {
    const errorBody = {
      kind: 21023,
      content: "internal server error",
      tags: [["code", "payment-error-server"]],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        clone: () => ({ json: async () => errorBody }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU107");
    expect(result.message).toBe("internal server error");
  });

  it("uses generic CU106 when a 402 body parses but has no code or content", async () => {
    const errorBody = { kind: 21023, tags: [], content: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        clone: () => ({ json: async () => errorBody }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU106");
    expect(result.message).toBe("CU106_message");
  });

  it("uses generic CU107 when a non-402 body parses but has no code or content", async () => {
    const errorBody = { kind: 21023, tags: [], content: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        clone: () => ({ json: async () => errorBody }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU107");
    expect(result.message).toBe("CU107_message");
  });

  it("treats whitespace-only content as empty on a 402", async () => {
    const errorBody = { kind: 21023, tags: [], content: "   " };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        clone: () => ({ json: async () => errorBody }),
      }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU106");
    expect(result.message).toBe("CU106_message");
  });

  it("passes through a 2xx as successful access grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, clone: () => ({}) }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(1);
    expect(result.label).toBe("access_granted_title");
  });

  it("maps a below-swap-fee code to CU110 on a 400 notice", async () => {
    const errorBody = {
      kind: 21023,
      content: "This e-cash note is 1 sat but mint x charges a 1 sat swap fee",
      tags: [["code", "payment-error-below-swap-fee"]],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, clone: () => ({ json: async () => errorBody }) }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.status).toBe(0);
    expect(result.code).toBe("CU110");
    expect(result.message).toContain("swap fee");
  });

  it("maps a mint-unreachable code to CU111", async () => {
    const errorBody = {
      kind: 21023,
      content: "Mint https://mint.example is temporarily unavailable.",
      tags: [["code", "payment-error-mint-unreachable"]],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, clone: () => ({ json: async () => errorBody }) }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.code).toBe("CU111");
  });

  it("maps an uncoded 'no outputs provided' message to CU110", async () => {
    const errorBody = {
      kind: 21023,
      content: "could not swap proofs: no outputs provided",
      tags: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, clone: () => ({ json: async () => errorBody }) }))
    );

    const result = await submitToken("cashuA", tollgateDetails, "30m", i18n);
    expect(result.code).toBe("CU110");
  });

  it("BUG A (submit-anyway path): pushes the RAW token to the merchant with null allocation when client-side decode refused", async () => {
    // This mirrors the "submit anyway" affordance: when the portal cannot
    // decode a token client-side (e.g. a v4 cashuB note with a v2 short keyset
    // id → CU102), the component still dispatches submitToken with the raw,
    // untrimmed token and NO allocation. The merchant is the authoritative
    // validator — it resolves short keyset ids via GetAllKeysets and decides
    // acceptance. Assert the raw token reaches the merchant POST body and that
    // a 2xx is still reported as success (granted, no allocation subtitle).
    const rawToken = "cashuB" + "synthetic-undecodable-note";
    let postedBody = null;
    let postedHeaders = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, opts) => {
        postedBody = opts?.body;
        postedHeaders = opts?.headers;
        return { ok: true, status: 200, clone: () => ({}) };
      })
    );

    // The bypass path passes allocation = null (there is no validated value).
    const result = await submitToken(rawToken, tollgateDetails, null, i18n);

    expect(postedBody).toBe(rawToken);
    expect(postedHeaders).toEqual({ "Content-Type": "text/plain" });
    expect(result.status).toBe(1);
    expect(result.label).toBe("access_granted_title");
    // No allocation to report — uses the dedicated granted message.
    expect(result.message).toBe("submit_anyway_granted_message");
  });
});

// The "submit anyway — router will validate it" affordance is gated on a
// decode-only refusal (CU102). These assertions pin the gate: it lights up when
// the sole barrier is the client-side keyset-agnostic decode, and stays hidden
// for hard format failures (CU100 empty / CU101 not-a-cashu-token).
describe("canSubmitAnyway affordance gating (BUG A)", () => {
  it("offers the bypass when the only barrier is a CU102 decode refusal", () => {
    // A cashu-prefixed token the client decoder rejects → CU102.
    const result = validateToken("cashuBnot-valid-cbor!!", null, i18n);
    expect(result.code).toBe("CU102");
    // the affordance is offered …
    expect(canSubmitAnyway(result)).toBe(true);
    // … and the raw token is what reaches the merchant (see submitToken test).
  });

  it("withholds the bypass for hard format failures (CU100 empty, CU101 not cashu)", () => {
    const empty = validateToken("", null, i18n);
    expect(empty.code).toBe("CU100");
    expect(canSubmitAnyway(empty)).toBe(false);

    const notCashu = validateToken("not-a-cashu-token", null, i18n);
    expect(notCashu.code).toBe("CU101");
    expect(canSubmitAnyway(notCashu)).toBe(false);
  });

  it("does not offer the bypass when the token decodes after all (short-keyset v4)", () => {
    // A v4 cashuB note whose proofs carry a v2 SHORT keyset id (`01`-prefixed).
    // Built synthetically so no real bearer-token literal ships in the source.
    // This is the exact shape of coinos.io / minibits notes (see the fixture in
    // tests/unit/mint-fee.test.js) and the short-keyset regression in
    // tests/unit/cashu-validateToken.test.js.
    const shortKeysetToken = getEncodedToken({
      mint: "https://mint.coinos.io",
      unit: "sat",
      proofs: [{ amount: 1, id: "01ad268c4d1f5826", secret: "s", C: `02${"a".repeat(64)}` }],
    });
    const result = validateToken(shortKeysetToken, { unit: "sat" }, i18n);
    // decodes now → no CU102 → no bypass needed
    expect(result.code).not.toBe("CU102");
    expect(result.status).toBe(1);
    expect(canSubmitAnyway(result)).toBe(false);
  });
});
