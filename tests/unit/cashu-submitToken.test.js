import { describe, it, expect, vi, afterEach } from "vitest";

// Mock nostr-tools crypto so we can drive submitToken straight to the
// fetch/error-parsing path without real key generation (nostr-tools'
// signing throws on jsdom without a proper Uint8Array env).
vi.mock("nostr-tools", () => ({
  getPublicKey: () => "1".repeat(64),
  getEventHash: (e) => "2".repeat(64),
  getSignature: () => "3".repeat(128),
}));

import { submitToken } from "../../src/helpers/cashu.js";

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
});
