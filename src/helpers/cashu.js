// external
import { getTokenMetadata, getDecodedToken } from "@cashu/cashu-ts";
import { getPublicKey, getEventHash, getSignature } from "nostr-tools";

// helpers
import { getTollgateBaseUrl } from "./tollgate";

// safely extract proofs from a decoded token, handling different possible token formats
export const extractProofsFromToken = (decodedToken) => {
  const proofs = [];

  try {
    // handle token array format
    if (decodedToken.token && Array.isArray(decodedToken.token)) {
      decodedToken.token.forEach((t) => {
        if (t.proofs && Array.isArray(t.proofs)) {
          proofs.push(...t.proofs);
        }
      });
    }
    // handle single token format
    else if (decodedToken.token && decodedToken.token.proofs) {
      proofs.push(...decodedToken.token.proofs);
    }
    // handle direct token structure
    else if (decodedToken.proofs && Array.isArray(decodedToken.proofs)) {
      proofs.push(...decodedToken.proofs);
    }
    // handle token with tokens array
    else if (decodedToken.tokens && Array.isArray(decodedToken.tokens)) {
      decodedToken.tokens.forEach((t) => {
        if (t.proofs && Array.isArray(t.proofs)) {
          proofs.push(...t.proofs);
        }
      });
    }
    // handle getTokenMetadata output (keyset-agnostic summary): the proofs are
    // carried under `incompleteProofs`. These are real proofs (secret, C,
    // amount, dleq) with their keyset id intentionally stripped — sufficient
    // to sum the token value for display; presence does not imply DLEQ validity.
    else if (decodedToken.incompleteProofs && Array.isArray(decodedToken.incompleteProofs)) {
      proofs.push(...decodedToken.incompleteProofs);
    }
    // handle a bare getTokenMetadata metadata object with no proof list at all —
    // the amount is already summed, synthesize a single synthetic proof so value
    // display still works.
    else if (typeof decodedToken.amount !== 'undefined') {
      proofs.push({ amount: decodedToken.amount });
    }
  } catch (error) {
    // log and ignore extraction errors
    console.error("error extracting proofs:", error);
  }

  return proofs;
};

// Normalise a mint URL so the router's advertisement and the URL embedded in a
// Cashu note can be compared. In practice they disagree about the scheme (a
// router may advertise http:// on its LAN while the note says https://), a
// trailing slash, and case — all of which describe the same mint:
//
//   https://mint.example.com
//   https://mint.example.com/
//   http://mint.example.com
//   HTTPS://Mint.Example.COM//
//   https://mint.example.com:443
//
//   => "mint.example.com" for all of them
//
// Returns null for anything that is not a usable URL string, so callers can
// null-check instead of comparing garbage.
export const normalizeMintUrl = (url) => {
  if ("string" !== typeof url) return null;

  let value = url.trim().toLowerCase();
  if (!value) return null;

  // a default port is not a distinguishing feature
  const scheme = value.startsWith("http://") ? "http" : "https";
  value = value.replace(scheme === "http" ? /:80(?=\/|$)/ : /:443(?=\/|$)/, "");

  // the scheme is not a distinguishing feature either (see above)
  value = value.replace(/^https?:\/\//, "");

  // a mint URL never carries a query string or fragment
  value = value.replace(/[?#].*$/, "");

  // trailing slashes are not a distinguishing feature
  value = value.replace(/\/+$/, "");

  return value.length ? value : null;
};

// Every mint URL a decoded token states. getTokenMetadata summarises a single
// mint as `mint`; the structural decoders carry it per entry under `token`
// (V2/V3) or `tokens`.
const mintUrlsFromDecoded = (decoded) => {
  const urls = [];
  const push = (url) => {
    if (typeof url === "string" && url.trim()) urls.push(url.trim());
  };

  push(decoded.mint);
  for (const entry of [].concat(decoded.token || [], decoded.tokens || [])) {
    if (entry && "object" === typeof entry) push(entry.mint);
  }

  return urls;
};

// Decode just enough of a note to learn WHICH MINT issued it.
//
// Decoder precedence mirrors validateToken: `getTokenMetadata` is the PRIMARY,
// keyset-agnostic decoder (the #CU102 fix — real coinos/minibits v4 `cashuB`
// notes carry v2 SHORT keyset ids that `getDecodedToken(token)` cannot map
// without the mint's keysets, and it throws on them), and `getDecodedToken` is
// the fallback for shapes metadata refuses (V3 multi-entry). Neither call is
// given keyset ids: cashu-ts wants `MintKeyset` OBJECTS there, and passing id
// strings throws the hardware `TypeError … reading 'slice'`.
//
// Returns the mint URL exactly as the note spells it, or null when the mint is
// unknowable. It never throws — it runs on every keystroke while a token is
// being typed/pasted — and it stays null for an AMBIGUOUS note (multi-mint /
// multi-entry) so the UI asks the user instead of guessing.
export const mintUrlFromToken = (token) => {
  try {
    if ("string" !== typeof token) return null;

    const trimmed = token.trim();
    if (!trimmed.startsWith("cashu")) return null;

    let decoded = null;
    try {
      decoded = getTokenMetadata(trimmed) || null;
    } catch (errMeta) {
      try {
        decoded = getDecodedToken(trimmed) || null;
      } catch (errDecode) {
        decoded = null;
      }
    }
    if (!decoded) return null;

    const candidates = mintUrlsFromDecoded(decoded);
    if (!candidates.length) return null;

    // Unambiguous only: every stated mint must normalise to the same mint.
    const distinct = [...new Set(candidates.map(normalizeMintUrl).filter(Boolean))];
    if (distinct.length !== 1) return null;

    return candidates.find((url) => normalizeMintUrl(url) === distinct[0]) || null;
  } catch (error) {
    // garbage, truncated pastes, unexpected decoder failures — never fatal
    return null;
  }
};

// The advertised access option (the router's `price_per_step` entry) for a mint
// URL, compared on the normalised form so scheme/slash/case differences between
// the note and the advertisement cannot silently miss. Returns null when the
// router does not accept that mint.
export const findMintOption = (mintUrl, options) => {
  const wanted = normalizeMintUrl(mintUrl);
  if (!wanted || !Array.isArray(options)) return null;

  return options.find((option) => normalizeMintUrl(option?.url) === wanted) || null;
};

// validate a cashu token: check format, decode, extract proofs, and sum value
export const validateToken = (token = "", mint, i18n) => {
  try {
    // check for empty or non-string token
    if ("string" !== typeof token || !token.trim()) {
      return {
        status: 0,
        code: "CU100",
        label: i18n("CU100_label"),
        message: i18n("CU100_message"),
      };
    }

    // basic validation - cashu tokens should start with "cashu"
    if (!token.trim().startsWith("cashu")) {
      return {
        status: 0,
        code: "CU101",
        label: i18n("CU101_label"),
        message: i18n("CU101_message"),
      };
    }

    // attempt to decode the token.
    //
    // PRIMARY PATH — getTokenMetadata: a keyset-agnostic decoder that works
    // WITHOUT the mint's keyset list. cashu-ts's getDecodedToken(token) (no
    // keysets) throws on v4 cashuB tokens whose proofs carry a v2 SHORT keyset
    // id (e.g. coinos.io or minibits cashuB notes) — the "A short keyset ID v2
    // was encountered, but got no keysets to map it to." error that was being
    // misreported as CU102. getTokenMetadata resolves proofs without needing to
    // map short -> full keyset ids, so those tokens decode here. The backend
    // (merchant) re-decodes authoritatively on submit.
    //
    // FALLBACK PATH — getDecodedToken: getTokenMetadata throws on multi-entry
    // (multi-mint) V3 tokens, which getDecodedToken-with-keysets handled. Keep
    // it so multi-mint tokens (which cashu-ts 2.9.0 requires MintKeyset objects
    // for) can still fall through to this decoder when it can decode them.
    const trimmedToken = token.trim();
    let decodedToken = null;
    try {
      decodedToken = getTokenMetadata(trimmedToken) || null;
    } catch (errMeta) {
      console.error("getTokenMetadata failed for token:", errMeta);
      try {
        decodedToken = getDecodedToken(trimmedToken);
      } catch (errDecode) {
        console.error("getDecodedToken fallback failed for token:", errDecode);
        decodedToken = null;
      }
    }
    if (!decodedToken) {
      return {
        status: 0,
        code: "CU102",
        label: i18n("CU102_label"),
        message: i18n("CU102_message"),
      };
    }

    // extract proofs from the token
    const proofs = extractProofsFromToken(decodedToken);
    if (!proofs || proofs.length === 0) {
      return {
        status: 0,
        code: "CU103",
        label: i18n("CU103_label"),
        message: i18n("CU103_message"),
      };
    }

    const totalAmount = proofs.reduce((sum, proof) => {
      const proofAmount = Number(proof.amount || 0);
      return sum + proofAmount;
    }, 0);

    // verify token unit matches the selected mint's unit
    if (mint && mint.unit) {
      const decodedUnit = decodedToken.unit || "sat";
      if (decodedUnit !== mint.unit) {
        return {
          status: 0,
          code: "CU109",
          label: i18n("CU109_label", "Token unit mismatch"),
          message: i18n(
            "CU109_message",
            `Token unit (${decodedUnit}) does not match mint unit (${mint.unit})`
          ),
        };
      }
    }

    // return the token value with proof details
    return {
      status: 1,
      value: {
        isValid: true,
        hasProofs: true,
        amount: totalAmount,
        proofCount: proofs.length,
        unit: decodedToken.unit || "sat",
      },
    };
  } catch (error) {
    // catch and report unexpected errors
    console.error("error decoding token:", error);
    return {
      status: 0,
      code: "CU104",
      label: i18n("CU104_label"),
      message: i18n("CU104_message"),
    };
  }
};

// The portal may offer the "submit anyway — router will validate it" bypass only
// for a *decode-only* refusal: the token's keyset could not be resolved client
// side (CU102), yet the merchant can still attempt an authoritative redemption.
// Hard format failures are never submittable — CU100 (empty) and CU101 (not a
// cashu token) carry no usable payload to hand the merchant, so the option is
// deliberately withheld for them.
export const canSubmitAnyway = (validation) =>
  !!validation && validation.status !== 1 && validation.code === "CU102";

// submit a cashu token to the tollgate backend for payment.
//
// HTTP-01 raw-token POST: the Cashu token is a bearer instrument, so the
// backend authorizes the spend from the token itself — not from a Nostr
// signature. The backend derives the device identifier (MAC) from the
// request's network context. This matches the curl path used by the test
// framework's `pay_direct()` and the protocol's `curl -d 'cashuB...'` example.
export const submitToken = async (token, _tollgateDetails, allocation, i18n) => {
  try {
    const baseUrl = getTollgateBaseUrl();
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: token,
    });

    if (!response.ok) {
      // Parse the error response body — the backend rejects a payment with a
      // kind 21023 nostr event whose tags carry the error code and whose
      // content carries the human-readable message.
      let backendCode = null;
      let backendMessage = null;
      try {
        const errorBody = await response.clone().json();
        if (errorBody && errorBody.kind === 21023) {
          // Extract error code from tags: ["code", "payment-error-xxx"]
          if (errorBody.tags && Array.isArray(errorBody.tags)) {
            for (const tag of errorBody.tags) {
              if (Array.isArray(tag) && tag[0] === "code" && tag[1]) {
                backendCode = tag[1];
                break;
              }
            }
          }
          // Use content for the error message
          if (
            typeof errorBody.content === "string" &&
            errorBody.content.trim().length > 0
          ) {
            backendMessage = errorBody.content;
          }
        }
      } catch (e) {
        console.error("failed to parse error response body:", e);
      }

      // Map the backend's machine code to a friendly CU code regardless of the
      // HTTP status: backend kind 21023 notices are sent with 400 (not 402), so
      // keying off 402 alone missed every coded error.
      const byCode = {
        "payment-error-below-swap-fee": "CU110",
        "payment-error-mint-unreachable": "CU111",
        "payment-error-dleq-keyset-rotation": "CU109",
      };
      let friendlyCode = byCode[backendCode] || null;

      if (!friendlyCode && backendMessage) {
        const text = String(backendMessage).toLowerCase();
        if (text.includes("swap fee") || text.includes("nothing to swap") || text.includes("no outputs")) {
          friendlyCode = "CU110";
        } else if (text.includes("keyset")) {
          friendlyCode = "CU109";
        } else if (
          text.includes("unreachable") ||
          text.includes("connection refused") ||
          text.includes("temporarily unavailable") ||
          text.includes("no such host")
        ) {
          friendlyCode = "CU111";
        }
      }

      if (friendlyCode) {
        console.error("backend payment error:", backendCode, backendMessage);
        // CU110/CU111 carry precise, user-facing backend messages (amount/fee);
        // CU109 keeps its dedicated localized copy.
        const message = friendlyCode !== "CU109" && backendMessage
          ? backendMessage
          : i18n(`${friendlyCode}_message`);
        return {
          status: 0,
          code: friendlyCode,
          label: i18n(`${friendlyCode}_label`),
          message,
        };
      }

      // Fall back to the previous generic behavior: 402 -> CU106, other -> CU107.
      if (response.status === 402) {
        console.error("backend error:", backendCode, backendMessage);
        return {
          status: 0,
          code: "CU106",
          label: i18n("CU106_label"),
          message: backendMessage || i18n("CU106_message"),
        };
      }
      // other server error — surface the backend message if one was parsed
      if (backendMessage) {
        console.error("server error:", backendCode, backendMessage);
        return {
          status: 0,
          code: "CU107",
          label: i18n("CU107_label"),
          message: backendMessage,
        };
      }
      console.error("server error:", backendCode, backendMessage, response);
      return {
        status: 0,
        code: "CU107",
        label: i18n("CU107_label"),
        message: backendMessage || i18n("CU107_message"),
      };
    }

    return {
      status: 1,
      label: i18n("access_granted_title"),
      // Normal flow: report the granted allocation. Bypass ("submit anyway")
      // flow: the token wasn't validated client-side (e.g. a v2 short-keyset
      // token), so there is no allocation to report — the merchant authorised
      // the spend directly, confirmed by the 2xx.
      message: allocation
        ? i18n("access_granted_subtitle", { purchased: allocation })
        : i18n("submit_anyway_granted_message"),
    };
  } catch (error) {
    console.error("error sending token:", error);
    return {
      status: 0,
      code: "CU108",
      label: i18n("CU108_label"),
      message: i18n("CU108_message"),
    };
  }
};
