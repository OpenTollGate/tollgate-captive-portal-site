// V4 → V3 Token Converter
//
// The portal validates both V3 (cashuA) and V4 (cashuB) tokens using
// @cashu/cashu-ts getDecodedToken(). But the Go backend (gonuts-tollgate)
// only accepts V3 format. This module converts V4 tokens to V3 before
// sending to the backend.
//
// The V4 format uses CBOR encoding; V3 uses JSON + base64url. This module
// implements a minimal CBOR decoder sufficient for Cashu V4 tokens.

export function ensureV3(tokenStr) {
  const stripped = stripPrefix(tokenStr);
  if (!stripped.startsWith("cashu")) return tokenStr;

  const version = stripped[5];
  if (version === "A") return tokenStr;
  if (version !== "B") return tokenStr;

  try {
    const decoded = decodeTokenToObject(stripped);
    return encodeV3Token(decoded);
  } catch (e) {
    console.error("V4→V3 conversion failed:", e);
    return tokenStr;
  }
}

function stripPrefix(token) {
  const schemes = ["web+cashu://", "cashu://", "cashu:", "cashu"];
  for (const scheme of schemes) {
    if (token.startsWith(scheme)) {
      return "cashu" + token.slice(scheme.length);
    }
  }
  return token;
}

function encodeV3Token(token) {
  const v3Payload = {
    token: [
      {
        mint: token.mint,
        proofs: token.proofs.map((p) => ({
          id: p.id,
          amount: p.amount,
          secret: p.secret,
          C: p.C,
        })),
      },
    ],
    unit: token.unit || "sat",
    mint: token.mint,
  };
  if (token.memo) v3Payload.memo = token.memo;

  const json = JSON.stringify(v3Payload);
  const base64 = btoa(json);
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "cashuA" + base64url;
}

function decodeTokenToObject(strippedToken) {
  const afterPrefix = strippedToken.slice(5);
  const version = afterPrefix[0];
  const payload = afterPrefix.slice(1);

  if (version === "A") return decodeV3(payload);
  if (version === "B") return decodeV4(payload);
  throw new Error("Unsupported token version: " + version);
}

function decodeV3(base64urlPayload) {
  let base64 = base64urlPayload.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const parsed = JSON.parse(atob(base64));
  if (!parsed.token || !Array.isArray(parsed.token) || parsed.token.length === 0) {
    throw new Error("Invalid V3 token: missing token array");
  }
  const entry = parsed.token[0];
  return {
    mint: entry.mint,
    proofs: entry.proofs.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      secret: p.secret,
      C: p.C,
    })),
    unit: parsed.unit || "sat",
    ...(parsed.memo && { memo: parsed.memo }),
  };
}

function decodeV4(base64urlPayload) {
  let base64 = base64urlPayload.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const cbor = decodeCBOR(bytes);

  const proofs = [];
  for (const entry of cbor.t) {
    const keysetId = bytesToHex(entry.i);
    for (const p of entry.p) {
      proofs.push({
        id: keysetId,
        amount: Number(p.a),
        secret: p.s,
        C: bytesToHex(p.c),
      });
    }
  }

  return {
    mint: cbor.m,
    proofs,
    unit: cbor.u || "sat",
    ...(cbor.d && { memo: cbor.d }),
  };
}

function decodeCBOR(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  function read() {
    if (offset >= view.byteLength) throw new Error("CBOR: unexpected end");
    const header = view.getUint8(offset++);
    const majorType = header >> 5;
    const info = header & 0x1f;

    switch (majorType) {
      case 0: return readUint(info);
      case 1: return -(readUint(info) + 1);
      case 2: return readBytes(info);
      case 3: return readText(info);
      case 4: return readArray(info);
      case 5: return readMap(info);
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error("CBOR: unsupported simple value " + info);
      default:
        throw new Error("CBOR: unsupported major type " + majorType);
    }
  }

  function readUint(info) {
    if (info < 24) return info;
    if (info === 24) return view.getUint8(offset++);
    if (info === 25) { const v = view.getUint16(offset); offset += 2; return v; }
    if (info === 26) { const v = view.getUint32(offset); offset += 4; return v; }
    if (info === 27) {
      const hi = view.getUint32(offset);
      const lo = view.getUint32(offset + 4);
      offset += 8;
      if (hi > 0) return Number.MAX_SAFE_INTEGER;
      return lo;
    }
    throw new Error("CBOR: unsupported uint info " + info);
  }

  function readLength(info) {
    return readUint(info);
  }

  function readBytes(info) {
    const len = readLength(info);
    const bytes = new Uint8Array(data.buffer, data.byteOffset + offset, len);
    offset += len;
    return bytes;
  }

  function readText(info) {
    const len = readLength(info);
    const bytes = new Uint8Array(data.buffer, data.byteOffset + offset, len);
    offset += len;
    return new TextDecoder().decode(bytes);
  }

  function readArray(info) {
    const len = readLength(info);
    const arr = [];
    for (let i = 0; i < len; i++) arr.push(read());
    return arr;
  }

  function readMap(info) {
    const len = readLength(info);
    const map = {};
    for (let i = 0; i < len; i++) {
      const key = read();
      const value = read();
      map[key] = value;
    }
    return map;
  }

  return read();
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
