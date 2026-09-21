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

// getMintSwapFee returns { status: 1, value: { fee, amount, netAmount, mint } }
// or { status: 0 } when the fee cannot be determined (bad token, mint
// unreachable, or a keyset the token references is unknown). Callers treat
// status 0 as "no pre-check" and let the payment path classify any error.
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
    for (const keyset of keysets) {
      if (keyset?.id) feeByFullId[String(keyset.id).toLowerCase()] = Number(keyset.input_fee_ppk || 0);
    }
    const keysetIds = keysets.map((keyset) => keyset.id);

    // Resolve the token (V4 short keyset IDs map onto the mint's keysets).
    const decoded = getDecodedToken(trimmed, keysetIds);
    const proofs = Array.isArray(decoded?.proofs) ? decoded.proofs : [];

    let ppk = 0;
    let amount = 0;
    for (const proof of proofs) {
      amount += amountToNumber(proof.amount);
      const id = String(proof.id || "").toLowerCase();
      const fullId = feeByFullId[id] !== undefined
        ? id
        : Object.keys(feeByFullId).find((candidate) => candidate.startsWith(id));
      if (fullId) ppk += feeByFullId[fullId];
    }

    // Fall back to the metadata sum if decoding yielded no proofs.
    if (!proofs.length) amount = amountToNumber(metadata.amount);

    const fee = Math.ceil(ppk / 1000);
    return { status: 1, value: { fee, amount, netAmount: Math.max(amount - fee, 0), mint } };
  } catch (error) {
    console.error("mint fee check failed:", error);
    return { status: 0 };
  }
};
