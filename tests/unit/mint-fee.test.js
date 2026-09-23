import { describe, it, expect, vi, afterEach } from "vitest";
import { getEncodedToken } from "@cashu/cashu-ts";
import { getMintSwapFee } from "../../src/helpers/mint-fee.js";

// ---------------------------------------------------------------------------
// Real production fixtures.
//
// COINOS_TOKEN is a REAL v4 (`cashuB`) note from mint.coinos.io: 1 sat, one
// proof, unit sat. Its CBOR proof keyset id is the 8-byte (16 hex char) v2
// SHORT keyset id `01182e5f5e35aecd`, i.e. the prefix of coinos' active keyset
// `01182e5f5e35aecd90da50a53c95667f745bc08ded556085c795c94adfa40b8591`.
//
// COINOS_KEYSETS is the verbatim body of `GET https://mint.coinos.io/v1/keysets`
// (HTTP 200) captured from the live mint — note `input_fee_ppk: 100` on the
// active keyset and the two inactive keysets it must not be confused with.
// ---------------------------------------------------------------------------
const COINOS_TOKEN =
  "cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIARguX141rs1hcIGkYWEBYXN4QGY0NDlkNjViNjIzODRiMDBhMjFkOTc0NDMxMTcyZjczMjJmOTY0MmUyZTMxNWJmOWNkYWNkMGY1MWMxNTM0NDVhY1ghAp5EotgRzBwfsUOgy-JfvPv7gFZsUaUYLPnjTlRTaOLjYWSjYWVYINcdcHmhadmEgJemHabRnCiW3hOitv5iVTfTJgolT6LyYXNYINtnsgyb_41n16rDDIEU243diHl_nxJbOsLjcaeeS-LNYXJYIDHknR1_DI-mAweiy9A7H600jT3Ebo4mz6F-TP8iJQ_O";

const COINOS_KEYSETS = {
  keysets: [
    {
      id: "01182e5f5e35aecd90da50a53c95667f745bc08ded556085c795c94adfa40b8591",
      unit: "sat",
      active: true,
      input_fee_ppk: 100,
      final_expiry: null,
    },
    {
      id: "004f7adf2a04356c",
      unit: "sat",
      active: false,
      input_fee_ppk: 0,
      final_expiry: null,
    },
    {
      id: "007311aa2fa58cc8",
      unit: "sat",
      active: false,
      input_fee_ppk: 100,
      final_expiry: null,
    },
  ],
};

// MINIBITS_SHORT_ID is the v2 short form of Minibits' live ACTIVE keyset
// `01fc0ec0e59cd6fa01b7a88f8cd77fce81fd1e64bca67d752e984992b7a3c3a821`.
// MINIBITS_TOKEN is built with cashu-ts' own v4 encoder in exactly the shape a
// Minibits note has (8-byte keyset id, 1 sat, one proof).
const MINIBITS_SHORT_ID = "01fc0ec0e59cd6fa";
const MINIBITS_TOKEN = getEncodedToken({
  mint: "https://mint.minibits.cash/Bitcoin",
  unit: "sat",
  proofs: [
    {
      amount: 1,
      id: MINIBITS_SHORT_ID,
      secret: "minibits-fixture-secret",
      C: `02${"a".repeat(64)}`,
    },
  ],
});

// Verbatim body of `GET https://mint.minibits.cash/Bitcoin/v1/keysets`
// (HTTP 200) — Minibits charges no input fee (`input_fee_ppk: 0`).
const MINIBITS_KEYSETS = {
  keysets: [
    {
      id: "01fc0ec0e59cd6fa01b7a88f8cd77fce81fd1e64bca67d752e984992b7a3c3a821",
      unit: "sat",
      active: true,
      input_fee_ppk: 0,
    },
    { id: "00500550f0494146", unit: "sat", active: false, input_fee_ppk: 0 },
    { id: "00107937db0cc865", unit: "sat", active: false, input_fee_ppk: 0 },
  ],
};

const okJson = (body) => ({ ok: true, json: async () => body });

describe("getMintSwapFee", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("computes the per-proof fee as ceil(sum(input_fee_ppk)/1000)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson(COINOS_KEYSETS)));

    const result = await getMintSwapFee(COINOS_TOKEN);
    expect(result.status).toBe(1);
    expect(result.value.fee).toBe(1);
    expect(result.value.amount).toBe(1);
    expect(result.value.netAmount).toBe(0);
  });

  // The hardware bug: on a real coinos note the helper threw
  //   TypeError: Cannot read properties of undefined (reading 'slice')
  // inside getDecodedToken(), the catch block logged
  //   "mint fee check failed: TypeError: ..." and returned {status: 0}.
  // Callers read status 0 as "no pre-check", so the CU110 gate never fired and
  // a 1-sat note worth 0 after the swap was presented as payable. Decoding a
  // token must not fail when the fee IS knowable from the mint's keysets — and
  // must not be silenced by a broader try/catch either.
  it("decodes a real v4 short-keyset token without logging a decode failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => okJson(COINOS_KEYSETS)));

    const result = await getMintSwapFee(COINOS_TOKEN);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(result.status).toBe(1);
    expect(result.value.fee).toBe(1);
    expect(result.value.netAmount).toBe(0);
  });

  it("keeps the fee at 0 for a zero-fee mint (Minibits, input_fee_ppk=0)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson(MINIBITS_KEYSETS)));

    const result = await getMintSwapFee(MINIBITS_TOKEN);
    expect(result.status).toBe(1);
    expect(result.value.fee).toBe(0);
    expect(result.value.amount).toBe(1);
    expect(result.value.netAmount).toBe(1);
  });

  // Regression guard (passes before and after the fix): a v0 long keyset id
  // needs no keyset mapping, so it must keep working — the fix has to stay
  // keyset-agnostic rather than special-case v2 short ids.
  it("still resolves a v0 (long keyset id) token", async () => {
    const token = getEncodedToken({
      mint: "https://mint.coinos.io",
      unit: "sat",
      proofs: [
        {
          amount: 1,
          id: "004f7adf2a04356c",
          secret: "v0-fixture-secret",
          C: `02${"b".repeat(64)}`,
        },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => okJson(COINOS_KEYSETS)));

    const result = await getMintSwapFee(token);
    expect(result.status).toBe(1);
    expect(result.value.fee).toBe(0);
    expect(result.value.amount).toBe(1);
  });

  it("returns status 0 when the mint's keysets are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const result = await getMintSwapFee(COINOS_TOKEN);
    expect(result.status).toBe(0);
  });
});
