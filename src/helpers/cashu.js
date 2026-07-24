// external
import { getDecodedToken } from "@cashu/cashu-ts";

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
  } catch (error) {
    // log and ignore extraction errors
    console.error("error extracting proofs:", error);
  }

  return proofs;
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

    // attempt to decode the token using the getDecodedToken method
    let decodedToken = null;
    try {
      decodedToken = getDecodedToken(token.trim());
      if (!decodedToken) {
        return {
          status: 0,
          code: "CU102",
          label: i18n("CU102_label"),
          message: i18n("CU102_message"),
        };
      }
    } catch (err) {
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

    // calculate the sum of proof values
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
        unit: "sat",
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
      if (response.status === 402) {
        return {
          status: 0,
          code: "CU106",
          label: i18n("CU106_label"),
          message: i18n("CU106_message"),
        };
      }
      // Backend returns a kind=21023 Notice event JSON for other errors;
      // surface the server's code tag if present, else fall back to CU107.
      let serverCode = "CU107";
      try {
        const notice = await response.clone().json();
        const codeTag = (notice.tags || []).find((t) => t[0] === "code");
        if (codeTag && codeTag[1]) serverCode = codeTag[1];
      } catch (_) { /* not JSON; fall through with CU107 */ }
      return {
        status: 0,
        code: serverCode,
        label: i18n(`${serverCode}_label`, i18n("CU107_label")),
        message: i18n(`${serverCode}_message`, i18n("CU107_message")),
      };
    }

    return {
      status: 1,
      label: i18n("access_granted_title"),
      message: i18n("access_granted_subtitle", { purchased: allocation }),
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
