import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getAccessOptions } from "../tollgate.js";
import { validateToken, mintUrlFromToken, findMintOption } from "../cashu.js";

const i18n = (k, d) => d ?? k;

const fixture = (name) =>
  readFileSync(`${import.meta.dirname}/../../../tests/fixtures/corpus/${name}.cashu`, "utf8").trim();

const retokenize = (token, mutate) => {
  const b64 = token.slice("cashuA".length);
  const json = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  mutate(json);
  const out = Buffer.from(JSON.stringify(json), "utf8").toString("base64url");
  return `cashuA${out}`;
};

const adEvent = {
  kind: 10021,
  tags: [
    ["metric", "milliseconds"],
    ["step_size", "60000"],
    ["price_per_step", "cashu", "210", "sat", "http://192.168.13.221:8383", "1"],
    ["price_per_step", "cashu", "21", "sat", "https://coinos.io/api/mint", "1"],
    ["price_per_step", "cashu", "500", "eur", "https://mint.thirddomain.eu", "3"],
  ],
};

const options = getAccessOptions(adEvent, i18n);

describe("#952 app-level flow: advertisement -> mint selection -> validation", () => {
  it("parses the advertisement into three cashu access options", () => {
    expect(options.map((o) => o.url).sort()).toEqual([
      "http://192.168.13.221:8383",
      "https://coinos.io/api/mint",
      "https://mint.thirddomain.eu",
    ]);
  });

  it("selects the advertised mint for a cdk-style V2 token (short keyset id)", () => {
    const token = fixture("v3_v2_kg181");
    const noteMint = mintUrlFromToken(token);
    expect(noteMint).toBeTruthy();
    const match = findMintOption(noteMint, options);
    expect(match?.url).toBe("http://192.168.13.221:8383");
    const validation = validateToken(token, match, i18n);
    expect(validation.status).toBe(1);
    expect(validation.value.amount).toBe(4);
  });

  it("selects the same mint when the note spells the URL with a trailing slash", () => {
    const token = retokenize(fixture("v3_v2_kg181"), (j) => {
      j.token[0].mint = "http://192.168.13.221:8383/";
    });
    const match = findMintOption(mintUrlFromToken(token), options);
    expect(match?.url).toBe("http://192.168.13.221:8383");
  });

  it("selects for a V4 token (8-byte keyset id)", () => {
    const token = fixture("v4_v2_kg181");
    const match = findMintOption(mintUrlFromToken(token), options);
    expect(match?.url).toBe("http://192.168.13.221:8383");
    expect(validateToken(token, match, i18n).status).toBe(1);
  });

  it("yields no option for a mint this router does not accept (unsupported-mint path)", () => {
    const token = retokenize(fixture("v3_v2_kg181"), (j) => {
      j.token[0].mint = "https://other-mint.example";
    });
    expect(mintUrlFromToken(token)).toBeTruthy();
    expect(findMintOption(mintUrlFromToken(token), options)).toBeNull();
  });

  it("CU109 fires on UNIT mismatch, not on keyset ids (the current meaning)", () => {
    const token = retokenize(fixture("v3_v2_kg181"), (j) => {
      j.unit = "usd";
    });
    const validation = validateToken(token, options[0], i18n);
    expect(validation.status).toBe(0);
    expect(validation.code).toBe("CU109");
    expect(String(validation.message)).toContain("usd");
  });
});
