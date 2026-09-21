import { describe, it, expect, vi, afterEach } from "vitest";
import { getMintSwapFee } from "../../src/helpers/mint-fee.js";

// V4 token (1 sat) from mint.coinos.io, active keyset 01182e5f... (ppk=100).
const TOKEN =
  "cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIARguX141rs1hcIGkYWEBYXN4QGY0NDlkNjViNjIzODRiMDBhMjFkOTc0NDMxMTcyZjczMjJmOTY0MmUyZTMxNWJmOWNkYWNkMGY1MWMxNTM0NDVhY1ghAp5EotgRzBwfsUOgy-JfvPv7gFZsUaUYLPnjTlRTaOLjYWSjYWVYINcdcHmhadmEgJemHabRnCiW3hOitv5iVTfTJgolT6LyYXNYINtnsgyb_41n16rDDIEU243diHl_nxJbOsLjcaeeS-LNYXJYIDHknR1_DI-mAweiy9A7H600jT3Ebo4mz6F-TP8iJQ_O";

const KEYSETS = {
  keysets: [
    {
      id: "01182e5f5e35aecd90da50a53c95667f745bc08ded556085c795c94adfa40b8591",
      unit: "sat",
      input_fee_ppk: 100,
      active: true,
    },
    { id: "004f7adf2a04356c", unit: "sat", input_fee_ppk: 0, active: false },
  ],
};

const okJson = (body) => ({ ok: true, json: async () => body });

describe("getMintSwapFee", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes the per-proof fee as ceil(sum(input_fee_ppk)/1000)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson(KEYSETS)));

    const result = await getMintSwapFee(TOKEN);
    expect(result.status).toBe(1);
    expect(result.value.fee).toBe(1);
    expect(result.value.amount).toBe(1);
    expect(result.value.netAmount).toBe(0);
  });

  it("returns status 0 when the mint's keysets are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const result = await getMintSwapFee(TOKEN);
    expect(result.status).toBe(0);
  });
});
