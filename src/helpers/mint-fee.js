// helpers/mint-fee.js
//
// Computes the swap fee a mint charges for a Cashu token — the sum of each
// proof's keyset input_fee_ppk, then ceil/1000, matching the backend wallet
// (gonuts feesForProofs). Used to pre-check a token before the user submits it,
// so a token that is entirely consumed by the mint's fee gets a clear message
// instead of the mint's opaque "no outputs provided" error.

import { getTokenMetadata, getDecodedToken } from "@cashu/cashu-ts";

const amountToNumber = (amount) => {
  if (amount == null) return 0;
  if (typeof amount.toNumber === "function") return amount.toNumber();
  if (typeof amount.toNumberUnsafe === "function") return amount.toNumberUnsafe();
  if (typeof amount.value === "bigint") return Number(amount.value);
  return Number(amount);
};

// getDecodedToken(token, keysets) expects MintKeyset OBJECTS as its second
// argument, not an array of id strings: cashu-ts maps a v2 SHORT keyset id by
// doing `a.id.slice(0, proof.id.length)` over that array. Passing ids used to
// make that read `undefined.slice` and throw
//   TypeError: Cannot read properties of undefined (reading 'slice')
// on every real v4 short-keyset note (coinos.io, minibits), which the catch
// below then turned into a silent { status: 0 } "no pre-check".
const decodeProofs = (token, mintKeysets) => {
  // Pass the mint's keysets so short ids resolve; retry without them so the
  // decode also covers tokens whose keyset ids need no mapping (v0 long ids).
  const attempts = [mintKeysets, undefined];
  let lastError;

  for (const keysets of attempts) {
    try {
      const decoded = keysets ? getDecodedToken(token, keysets) : getDecodedToken(token);
      if (Array.isArray(decoded?.proofs)) return { proofs: decoded.proofs };
    } catch (error) {
      lastError = error;
    }
  }

  return { proofs: [], error: lastError };
};

// Resolve a proof's keyset id (which may be short, or resolved) onto one of the
// mint's full keyset ids. An empty id must never match — `startsWith("")` would
// otherwise attribute the first keyset's fee to a proof with no known keyset.
const resolveKeysetId = (id, feeByFullId) => {
  if (!id) return undefined;
  if (feeByFullId[id] !== undefined) return id;
  return Object.keys(feeByFullId).find((candidate) => candidate.startsWith(id));
};

// getMintSwapFee returns { status: 1, value: { fee, amount, netAmount, mint } }
// or { status: 0 } when the fee cannot be determined (bad token, mint
// unreachable, or a keyset the token references is unknown). Callers treat
// status 0 as "no pre-check" and let the payment path classify any error. The
// only thing status 0 must never be is a stand-in for a fee we could have
// computed — that is how the CU110 "token too small" gate silently disappeared.
export const getMintSwapFee = async (token) => {
  try {
    const trimmed = (token || "").trim();
    if (!trimmed.startsWith("cashu")) return { status: 0 };

    const metadata = getTokenMetadata(trimmed);
    const mint = metadata?.mint;
    if (!mint) return { status: 0 };

    const response = await fetch(`${mint.replace(/\/+$/, "")}/v1/keysets`);
    if (!response.ok) return { status: 0 };
    const data = await response.json();
    const keysets = Array.isArray(data?.keysets) ? data.keysets : [];
    if (!keysets.length) return { status: 0 };

    const feeByFullId = {};
    const mintKeysets = [];
    for (const keyset of keysets) {
      if (!keyset?.id) continue;
      const fullId = String(keyset.id).toLowerCase();
      const ppk = Number(keyset.input_fee_ppk || 0);
      feeByFullId[fullId] = ppk;
      mintKeysets.push({ id: String(keyset.id), unit: keyset.unit, input_fee_ppk: ppk });
    }
    if (!mintKeysets.length) return { status: 0 };

    // Resolve the token (V4 short keyset IDs map onto the mint's keysets).
    const { proofs, error } = decodeProofs(trimmed, mintKeysets);
    if (!proofs.length) {
      // Still no pre-check, but stay diagnosable — this is the path that hid
      // the CU110 bug behind a swallowed TypeError.
      if (error) console.warn("mint fee check: could not decode token proofs:", error.message);
      return { status: 0 };
    }

    let ppk = 0;
    let amount = 0;
    for (const proof of proofs) {
      amount += amountToNumber(proof.amount);
      const id = String(proof.id || "").toLowerCase();
      const fullId = resolveKeysetId(id, feeByFullId);
      // A keyset we cannot map means the fee is not knowable: report
      // "no pre-check" rather than a fee that is silently too low.
      if (!fullId) {
        console.warn(`mint fee check: token references unknown keyset ${id} at ${mint}`);
        return { status: 0 };
      }
      ppk += feeByFullId[fullId];
    }

    const fee = Math.ceil(ppk / 1000);
    return { status: 1, value: { fee, amount, netAmount: Math.max(amount - fee, 0), mint } };
  } catch (error) {
    console.error("mint fee check failed:", error);
    return { status: 0 };
  }
};
