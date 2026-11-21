// src/jurnal/api.ts
import { createHmac, randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";

// node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder;
var decoder = new TextDecoder;
var strictDecoder = new TextDecoder("utf-8", { fatal: true });
var UINT32_RANGE = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0), buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers)
    buf.set(buffer, i), i += buffer.length;
  return buf;
}
var NON_ASCII = /[^\x00-\x7f]/;
function encode(string) {
  if (typeof string == "string" && string.length >= 128) {
    if (NON_ASCII.test(string))
      throw new TypeError("non-ASCII string encountered in encode()");
    return encoder.encode(string);
  }
  const bytes = new Uint8Array(string.length);
  for (let i = 0;i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127)
      throw new TypeError("non-ASCII string encountered in encode()");
    bytes[i] = code;
  }
  return bytes;
}
function encodeBase64(input, url = false) {
  if (Uint8Array.prototype.toBase64)
    return input.toBase64({ alphabet: url ? "base64url" : "base64", omitPadding: url });
  const CHUNK_SIZE = 32768, arr = [];
  for (let i = 0;i < input.length; i += CHUNK_SIZE)
    arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
  const encoded = btoa(arr.join(""));
  return url ? encoded.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") : encoded;
}
function decodeBase64(encoded, url = false) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(encoded, { alphabet: url ? "base64url" : "base64" });
  if (url) {
    if (encoded.includes("+") || encoded.includes("/"))
      throw new TypeError("Invalid base64url");
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  }
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0;i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// node_modules/jose/dist/webapi/util/errors.js
class JOSEError extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message, options) {
    super(message, options), this.name = this.constructor.name, Error.captureStackTrace?.(this, this.constructor);
  }
}

class JWTClaimValidationFailed extends JOSEError {
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message, payload, claim = "unspecified", reason = "unspecified") {
    super(message, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
}

class JWTExpired extends JOSEError {
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message, payload, claim = "unspecified", reason = "unspecified") {
    super(message, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
}

class JOSEAlgNotAllowed extends JOSEError {
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
}

class JOSENotSupported extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
}
class JWSInvalid extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
}

class JWTInvalid extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
}
class JWKSInvalid extends JOSEError {
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
}

class JWKSNoMatchingKey extends JOSEError {
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message = "no applicable key found in the JSON Web Key Set", options) {
    super(message, options);
  }
}

class JWKSMultipleMatchingKeys extends JOSEError {
  [Symbol.asyncIterator] = async function* () {};
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message, options);
  }
}

class JWKSTimeout extends JOSEError {
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message = "request timed out", options) {
    super(message, options);
  }
}

class JWSSignatureVerificationFailed extends JOSEError {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message = "signature verification failed", options) {
    super(message, options);
  }
}

// node_modules/jose/dist/webapi/util/base64url.js
var invalid = "The input to be decoded is not correctly encoded.";
function decode(input) {
  try {
    return decodeBase64(typeof input == "string" ? input : decoder.decode(input), true);
  } catch (cause) {
    throw new TypeError(invalid, { cause });
  }
}
function encode2(input) {
  return encodeBase64(typeof input == "string" ? encoder.encode(input) : input, true);
}

// node_modules/jose/dist/webapi/lib/validate.js
function isObject(input) {
  if (typeof input != "object" || input === null || Object.prototype.toString.call(input) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
function isJwkSet(input) {
  return isObject(input) && Array.isArray(input.keys) && Array.from(input.keys).every(isObject);
}
function isDisjoint(...headers) {
  const parameters = /* @__PURE__ */ new Set;
  for (const header of headers)
    if (header)
      for (const parameter of Object.keys(header)) {
        if (parameters.has(parameter))
          return false;
        parameters.add(parameter);
      }
  return true;
}
function assertNotSet(value, name) {
  if (value !== undefined)
    throw new TypeError(`${name} can only be called once`);
}
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch (cause) {
    throw new ErrorClass(`Failed to base64url decode the ${label}`, { cause });
  }
}
function encodeAsciiMember(value, label, ErrorClass) {
  try {
    return encode(value);
  } catch (cause) {
    throw new ErrorClass(`The ${label} is not a valid base64url string`, { cause });
  }
}
function parseJoseHeader(encodedProtectedHeader, ErrorClass, message) {
  let parsed;
  try {
    parsed = JSON.parse(strictDecoder.decode(decode(encodedProtectedHeader)));
  } catch (cause) {
    throw new ErrorClass(message, { cause });
  }
  if (!isObject(parsed))
    throw new ErrorClass(message);
  return parsed;
}
var JWS_RECOGNIZED = { __proto__: null, b64: true };
function validateAlgorithms(option, algorithms) {
  if (algorithms !== undefined && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s != "string")))
    throw new TypeError(`"${option}" option must be an array of strings`);
  return algorithms === undefined ? undefined : new Set(algorithms);
}
function validateCritDuplicates(Err, protectedHeader) {
  const { crit } = protectedHeader ?? {};
  if (Array.isArray(crit) && new Set(crit).size !== crit.length)
    throw new Err('"crit" (Critical) Header Parameter MUST NOT contain duplicate values');
}
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== undefined && protectedHeader?.crit === undefined)
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!protectedHeader || protectedHeader.crit === undefined)
    return [];
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input != "string" || input.length === 0))
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  const recognized = recognizedOption === undefined ? recognizedDefault : { __proto__: null, ...recognizedOption, ...recognizedDefault };
  for (const parameter of protectedHeader.crit) {
    if (!(parameter in recognized))
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    if (!Object.hasOwn(joseHeader, parameter) || joseHeader[parameter] === undefined)
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    if (recognized[parameter] && (!Object.hasOwn(protectedHeader, parameter) || protectedHeader[parameter] === undefined))
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
  }
  return protectedHeader.crit;
}
function validateB64(protectedHeader, extensions) {
  if (extensions.includes("b64")) {
    const b64 = protectedHeader.b64;
    if (typeof b64 != "boolean")
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return b64;
  }
  return true;
}
function serializeJoseHeader(Err, header) {
  let serialized, parsed;
  try {
    serialized = JSON.stringify(header), parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new Err("JOSE Header is not valid JSON", { cause });
  }
  if (!isObject(parsed))
    throw new Err("JOSE Header is not a JSON object");
  return [parsed, serialized];
}

// node_modules/jose/dist/webapi/lib/key.js
var tag = (key) => key[Symbol.toStringTag];
var jwkMatchesOp = (entry, key, usage) => {
  const { alg } = entry;
  if (key.use !== undefined) {
    const expected = usage === "sign" || usage === "verify" ? "sig" : "enc";
    if (key.use !== expected)
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
  }
  if (key.alg !== undefined && key.alg !== alg)
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  if (Array.isArray(key.key_ops)) {
    const expectedKeyOp = usage === "encrypt" || usage === "decrypt" ? entry.ops?.[usage === "encrypt" ? 0 : 1] : usage;
    if (expectedKeyOp && !key.key_ops.includes(expectedKeyOp))
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
  }
};
async function prepareKey(entry, key, usage) {
  const { alg, secret } = entry, requiresPrivateKey = usage === "decrypt" || usage === "sign";
  if (secret && key instanceof Uint8Array)
    return key;
  let normalized, keyObject;
  if (isObject(key)) {
    if (normalized = normalizeJwk(key), typeof normalized.kty != "string")
      throw invalidKeyType(alg, key, secret);
    if (!(secret ? normalized.kty === "oct" && typeof normalized.k == "string" : normalized.kty !== "oct" && (requiresPrivateKey ? normalized.kty === "AKP" && typeof normalized.priv == "string" || typeof normalized.d == "string" : normalized.d === undefined && normalized.priv === undefined)))
      throw new TypeError(secret ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present' : `JSON Web Key for this operation must be a ${requiresPrivateKey ? "private" : "public"} JWK`);
    if (jwkMatchesOp(entry, normalized, usage), normalized.kty === "oct")
      return decode(normalized.k);
    if (!Object.isFrozen(key)) {
      const { key_ops } = key;
      Array.isArray(key_ops) && Object.freeze(key_ops), Object.freeze(key);
    }
  } else {
    if (!isKeyLike(key))
      throw invalidKeyType(alg, key, secret);
    const expectedType = secret ? "secret" : requiresPrivateKey ? "private" : "public";
    if (key.type !== expectedType && (secret || ["secret", "public", "private"].includes(key.type)))
      throw new TypeError(`${tag(key)} instances must be of type "${expectedType}" for the ${alg} algorithm`);
    if (isCryptoKey(key))
      return key;
    if (keyObject = key, keyObject.type === "secret")
      return keyObject.export();
  }
  cache ||= /* @__PURE__ */ new WeakMap;
  const cacheKey = key;
  let cached = cache.get(cacheKey);
  if (cached?.[alg])
    return cached[alg];
  if (cached || cache.set(cacheKey, cached = {}), keyObject && typeof keyObject.toCryptoKey == "function") {
    const isPublic = keyObject.type === "public", crv = nist[keyObject.asymmetricKeyDetails?.namedCurve], params = entry.resolve?.({ crv, asymmetricKeyType: keyObject.asymmetricKeyType }) ?? entry.subtle;
    return cached[alg] = keyObject.toCryptoKey(params, isPublic, entry.usages[isPublic ? 0 : 1]);
  }
  return normalized ??= keyObject.export({ format: "jwk" }), normalized.alg = alg, cached[alg] = await jwkToKey(entry, normalized);
}
var cache;
var nist = {
  __proto__: null,
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521"
};
var isCryptoKey = (key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
};
var isKeyObject = (key) => key?.[Symbol.toStringTag] === "KeyObject";
var isKeyLike = (key) => isCryptoKey(key) || isKeyObject(key);
function message(msg, actual, ...types) {
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else
    types.length === 2 ? msg += `one of type ${types[0]} or ${types[1]}.` : msg += `of type ${types[0]}.`;
  return actual == null ? msg += ` Received ${actual}` : typeof actual == "function" && actual.name ? msg += ` Received function ${actual.name}` : typeof actual == "object" && actual != null && actual.constructor?.name && (msg += ` Received an instance of ${actual.constructor.name}`), msg;
}
function invalidKeyType(alg, actual, secret) {
  const types = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return secret && types.push("Uint8Array"), new TypeError(message(`Key for the ${alg} algorithm must be `, actual, ...types));
}
var unusable = (name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
}
function checkModulusLength(alg, key) {
  const { modulusLength } = key.algorithm;
  if (typeof modulusLength != "number" || modulusLength < 2048)
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
}
function checkCryptoKey(key, expected, usage) {
  const algorithm = key.algorithm;
  if (algorithm.name !== expected.name)
    throw unusable(expected.name);
  if (expected.hash && algorithm.hash?.name !== expected.hash)
    throw unusable(expected.hash, "algorithm.hash");
  if (expected.namedCurve && algorithm.namedCurve !== expected.namedCurve)
    throw unusable(expected.namedCurve, "algorithm.namedCurve");
  if (expected.length !== undefined && algorithm.length !== expected.length)
    throw unusable(expected.length, "algorithm.length");
  checkUsage(key, usage);
}
function snapshotJwk(jwk) {
  return { __proto__: null, ...jwk };
}
function normalizeJwk(jwk) {
  const normalized = snapshotJwk(jwk);
  if (normalized.ext !== undefined && typeof normalized.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (normalized.key_ops !== undefined) {
    const value = normalized.key_ops, keyOps = Array.isArray(value) ? [...value] : undefined;
    if (!keyOps || keyOps.some((operation) => typeof operation != "string") || new Set(keyOps).size !== keyOps.length)
      throw new TypeError('"key_ops" (Key Operations) Parameter must be an array of unique strings');
    normalized.key_ops = keyOps;
  }
  return normalized;
}
async function jwkToKey(entry, jwk, extractable) {
  if (!entry.kty.includes(jwk.kty))
    throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  const algorithm = entry.resolve?.({ kty: jwk.kty, crv: jwk.crv }) ?? entry.subtle, isPrivate = !!(jwk.d || jwk.priv), keyData = { ...jwk, ext: extractable ?? jwk.ext };
  return keyData.kty !== "AKP" && delete keyData.alg, delete keyData.use, crypto.subtle.importKey("jwk", keyData, algorithm, keyData.ext ?? !isPrivate, jwk.key_ops ?? entry.usages[isPrivate ? 1 : 0]);
}
async function rawKey(key, expected, usage, extractable = false) {
  return key instanceof Uint8Array && (key = await crypto.subtle.importKey("raw", key, expected, extractable, [usage])), checkCryptoKey(key, expected, usage), key;
}

// node_modules/jose/dist/webapi/lib/key_descriptor.js
function table(entries) {
  const out = { __proto__: null };
  for (const alg in entries)
    out[alg] = { ...entries[alg], alg };
  return out;
}

// node_modules/jose/dist/webapi/lib/jws_algorithms.js
var sig = [["verify"], ["sign"]];
function hmac(bits) {
  const subtle = { name: "HMAC", hash: `SHA-${bits}` };
  return { kty: ["oct"], secret: true, subtle, signing: subtle, usages: sig };
}
function rsa(bits, saltLength) {
  const subtle = { name: saltLength ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${bits}` };
  return {
    kty: ["RSA"],
    subtle,
    signing: saltLength ? { ...subtle, saltLength } : subtle,
    usages: sig,
    minRsaBits: 2048
  };
}
function ecdsa(crv, bits) {
  return {
    kty: ["EC"],
    crv,
    subtle: { name: "ECDSA", namedCurve: crv },
    signing: { name: "ECDSA", hash: `SHA-${bits}` },
    usages: sig
  };
}
function eddsa() {
  const subtle = { name: "Ed25519" };
  return {
    kty: ["OKP"],
    crv: "Ed25519",
    subtle,
    signing: subtle,
    usages: sig
  };
}
function mldsa(parameterSet) {
  const subtle = { name: `ML-DSA-${parameterSet}` };
  return {
    kty: ["AKP"],
    subtle,
    signing: subtle,
    usages: sig
  };
}
var JWS = table({
  HS256: hmac(256),
  HS384: hmac(384),
  HS512: hmac(512),
  RS256: rsa(256),
  RS384: rsa(384),
  RS512: rsa(512),
  PS256: rsa(256, 32),
  PS384: rsa(384, 48),
  PS512: rsa(512, 64),
  ES256: ecdsa("P-256", 256),
  ES384: ecdsa("P-384", 384),
  ES512: ecdsa("P-521", 512),
  EdDSA: eddsa(),
  Ed25519: eddsa(),
  "ML-DSA-44": mldsa(44),
  "ML-DSA-65": mldsa(65),
  "ML-DSA-87": mldsa(87)
});
function jwsAlgorithm(alg) {
  const entry = typeof alg == "string" ? JWS[alg] : undefined;
  if (!entry)
    throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  return entry;
}

// node_modules/jose/dist/webapi/lib/jws_verify.js
function prepareVerify(options) {
  return [options && validateAlgorithms("algorithms", options.algorithms), options?.crit];
}
function parseProtectedHeader(encodedProtectedHeader) {
  return encodedProtectedHeader === undefined ? {} : parseJoseHeader(encodedProtectedHeader, JWSInvalid, "JWS Protected Header is invalid");
}
function encodeCompactUnencodedPayload(payload) {
  try {
    return encode(payload);
  } catch (cause) {
    throw new JWSInvalid("JWS Compact Serialization payload must use only ASCII characters", {
      cause
    });
  }
}
async function verifySignature(jws, shared, key, encodeUnencodedPayload, parsedProtected) {
  const { protected: encodedProtectedHeader, header, payload: inputPayload } = jws, protectedHeader = parsedProtected ?? parseProtectedHeader(encodedProtectedHeader);
  if (!isDisjoint(protectedHeader, header))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...protectedHeader, ...header }, b64 = validateB64(protectedHeader, validateCrit(JWSInvalid, JWS_RECOGNIZED, shared[1], protectedHeader, joseHeader)), { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (shared[0] && !shared[0].has(alg))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  if (b64) {
    if (typeof inputPayload != "string")
      throw new JWSInvalid("JWS Payload must be a string");
  } else if (typeof inputPayload != "string" && !(inputPayload instanceof Uint8Array))
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  const signingPayload = b64 || typeof inputPayload != "string" ? inputPayload : encodeUnencodedPayload(inputPayload);
  let resolvedKey = false;
  typeof key == "function" && (key = await key(protectedHeader, jws), resolvedKey = true);
  const entry = jwsAlgorithm(alg), signingInput = concat(encodedProtectedHeader !== undefined ? encode(encodedProtectedHeader) : new Uint8Array, encode("."), typeof signingPayload == "string" ? shared[2] ??= encodeAsciiMember(signingPayload, "payload", JWSInvalid) : signingPayload), signature = decodeBase64url(jws.signature, "signature", JWSInvalid), verificationKey = await prepareKey(entry, key, "verify"), cryptoKey = await rawKey(verificationKey, entry.subtle, "verify");
  entry.minRsaBits && checkModulusLength(entry.alg, cryptoKey);
  let verified = false;
  try {
    verified = await crypto.subtle.verify(entry.signing, cryptoKey, signature, signingInput);
  } catch (cause) {
    throw new JWSSignatureVerificationFailed(undefined, { cause });
  }
  if (!verified)
    throw new JWSSignatureVerificationFailed;
  const result = { payload: typeof signingPayload == "string" ? decodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload };
  return encodedProtectedHeader !== undefined && (result.protectedHeader = protectedHeader), header !== undefined && (result.unprotectedHeader = header), resolvedKey ? [{ ...result, key: verificationKey }, b64] : [result, b64];
}
async function verifyCompact(jws, shared, key) {
  if (jws instanceof Uint8Array && (jws = decoder.decode(jws)), typeof jws != "string")
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3)
    throw new JWSInvalid("Invalid Compact JWS");
  return verifySignature({ payload, protected: protectedHeader, signature }, shared, key, encodeCompactUnencodedPayload);
}

// node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = (date) => Math.floor(date.getTime() / 1000);
var multipliers = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600
};
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var checkFailed = "check_failed";
function invalidDuration() {
  throw new TypeError("Invalid time period format");
}
function secs(str) {
  typeof str != "string" && invalidDuration();
  const matched = REGEX.exec(str);
  (!matched || matched[4] && matched[1]) && invalidDuration();
  const value = parseFloat(matched[2]), durationSeconds = Math.round(value * multipliers[matched[3][0].toLowerCase()]);
  return Number.isFinite(durationSeconds) || invalidDuration(), matched[1] === "-" || matched[4] === "ago" ? -durationSeconds : durationSeconds;
}
function validateInput(label, input) {
  if (!Number.isFinite(input))
    throw new TypeError(`Invalid ${label} input`);
  return input;
}
function validateStringClaim(claim, value) {
  if (typeof value != "string")
    throw new TypeError(`"${claim}" claim must be a string`);
}
function validateAudienceClaim(value) {
  if (typeof value != "string" && (!Array.isArray(value) || Array.from(value).some((member) => typeof member != "string")))
    throw new TypeError('"aud" claim must be a string or an array of strings');
}
function numericDate(value, label) {
  return typeof value == "number" ? validateInput(label, value) : value instanceof Date ? validateInput(label, epoch(value)) : epoch(/* @__PURE__ */ new Date) + secs(value);
}
var normalizeTyp = (value) => {
  const normalized = value.toLowerCase();
  return value.includes("/") ? normalized : `application/${normalized}`;
};
var checkAudiencePresence = (audPayload, audOption) => typeof audPayload == "string" ? audOption.includes(audPayload) : Array.isArray(audPayload) ? audOption.some((aud) => audPayload.includes(aud)) : false;
function validateNumericDate(claimsSet, claim, required = false) {
  const value = claimsSet[claim];
  if (!(value === undefined && !required)) {
    if (typeof value != "number")
      throw new JWTClaimValidationFailed(`"${claim}" claim must be a number`, claimsSet, claim, "invalid");
    return value;
  }
}
function unexpectedClaim(claimsSet, claim) {
  throw new JWTClaimValidationFailed(`unexpected "${claim}" claim value`, claimsSet, claim, checkFailed);
}
function validateClaimsSet(protectedHeader, claimsSetBytes, options = {}) {
  let claimsSet;
  try {
    claimsSet = JSON.parse(strictDecoder.decode(claimsSetBytes));
  } catch (cause) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object", { cause });
  }
  if (!isObject(claimsSet))
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  const { typ } = options;
  if (typ !== undefined && (typeof protectedHeader.typ != "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ)))
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', claimsSet, "typ", checkFailed);
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options, presenceCheck = [...requiredClaims];
  maxTokenAge !== undefined && presenceCheck.push("iat"), audience !== undefined && presenceCheck.push("aud"), subject !== undefined && presenceCheck.push("sub"), issuer !== undefined && presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse()))
    if (!Object.hasOwn(claimsSet, claim))
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, claimsSet, claim, "missing");
  issuer !== undefined && !(Array.isArray(issuer) ? issuer : [issuer]).includes(claimsSet.iss) && unexpectedClaim(claimsSet, "iss"), subject !== undefined && claimsSet.sub !== subject && unexpectedClaim(claimsSet, "sub"), audience !== undefined && !checkAudiencePresence(claimsSet.aud, typeof audience == "string" ? [audience] : audience) && unexpectedClaim(claimsSet, "aud");
  const { clockTolerance } = options;
  let tolerance = 0;
  if (typeof clockTolerance == "string")
    tolerance = secs(clockTolerance);
  else if (clockTolerance !== undefined) {
    if (typeof clockTolerance != "number")
      throw new TypeError("Invalid clockTolerance option type");
    tolerance = clockTolerance;
  }
  validateInput("clockTolerance option", tolerance);
  const { currentDate } = options, now = validateInput("currentDate option", epoch(currentDate === undefined ? /* @__PURE__ */ new Date : currentDate)), iat = validateNumericDate(claimsSet, "iat", maxTokenAge !== undefined), nbf = validateNumericDate(claimsSet, "nbf");
  if (nbf !== undefined && nbf > now + tolerance)
    throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', claimsSet, "nbf", checkFailed);
  const exp = validateNumericDate(claimsSet, "exp");
  if (exp !== undefined && exp <= now - tolerance)
    throw new JWTExpired('"exp" claim timestamp check failed', claimsSet, "exp", checkFailed);
  if (maxTokenAge !== undefined) {
    const age = now - iat, max = validateInput("maxTokenAge option", typeof maxTokenAge == "number" ? maxTokenAge : secs(maxTokenAge));
    if (age - tolerance > max)
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', claimsSet, "iat", checkFailed);
    if (age < -tolerance)
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', claimsSet, "iat", checkFailed);
  }
  return claimsSet;
}
var producerClaimsSets;
function producerClaimsSet(producer) {
  return producerClaimsSets.get(producer);
}
function jwtClaimsSetBytes(producer) {
  const claimsSet = producerClaimsSet(producer);
  for (const claim of ["iat", "nbf", "exp"]) {
    const value = claimsSet[claim];
    if (typeof value == "number" && !Number.isFinite(value))
      throw new TypeError(`"${claim}" claim must be a finite number`);
  }
  return encoder.encode(JSON.stringify(claimsSet));
}
class JWTClaimsBuilder {
  constructor(claimsSet = {}) {
    if (!isObject(claimsSet))
      throw new TypeError("JWT Claims Set MUST be an object");
    (producerClaimsSets ||= /* @__PURE__ */ new WeakMap).set(this, structuredClone(claimsSet));
  }
  setIssuer(value) {
    return validateStringClaim("iss", value), producerClaimsSet(this).iss = value, this;
  }
  setSubject(value) {
    return validateStringClaim("sub", value), producerClaimsSet(this).sub = value, this;
  }
  setAudience(value) {
    return validateAudienceClaim(value), producerClaimsSet(this).aud = value, this;
  }
  setJti(value) {
    return validateStringClaim("jti", value), producerClaimsSet(this).jti = value, this;
  }
  setNotBefore(value) {
    return producerClaimsSet(this).nbf = numericDate(value, "setNotBefore"), this;
  }
  setExpirationTime(value) {
    return producerClaimsSet(this).exp = numericDate(value, "setExpirationTime"), this;
  }
  setIssuedAt(value) {
    const claimsSet = producerClaimsSet(this);
    return value === undefined ? claimsSet.iat = epoch(/* @__PURE__ */ new Date) : typeof value == "string" ? claimsSet.iat = validateInput("setIssuedAt", epoch(/* @__PURE__ */ new Date) + secs(value)) : claimsSet.iat = numericDate(value, "setIssuedAt"), this;
  }
}

// node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const [verified, b64] = await verifyCompact(jwt, prepareVerify(options), key);
  if (!b64)
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  return { ...verified, payload };
}

// node_modules/jose/dist/webapi/lib/jws_sign.js
async function createSignature(input, key, rejectUnencoded) {
  let [payload, protectedHeader, unprotectedHeader, crit] = input, encodedProtectedHeader = "";
  if (protectedHeader !== undefined) {
    const normalized = serializeJoseHeader(JWSInvalid, protectedHeader);
    protectedHeader = normalized[0], encodedProtectedHeader = encode2(normalized[1]);
  }
  if (unprotectedHeader !== undefined && (unprotectedHeader = serializeJoseHeader(JWSInvalid, unprotectedHeader)[0]), !protectedHeader && !unprotectedHeader)
    throw new JWSInvalid("either setProtectedHeader or setUnprotectedHeader must be called before #sign()");
  if (!isDisjoint(protectedHeader, unprotectedHeader))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...protectedHeader, ...unprotectedHeader };
  validateCritDuplicates(JWSInvalid, protectedHeader);
  const b64 = validateB64(protectedHeader, validateCrit(JWSInvalid, JWS_RECOGNIZED, crit, protectedHeader, joseHeader));
  b64 || rejectUnencoded?.();
  const { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  const entry = jwsAlgorithm(alg);
  let encodedPayload = "", signingPayload = payload, signingInput;
  if (b64) {
    const encodedPayloadCache = input[4];
    encodedPayloadCache ? (encodedPayload = encodedPayloadCache[0] ??= encode2(payload), signingPayload = encodedPayloadCache[1] ??= encode(encodedPayload)) : (encodedPayload = encode2(payload), signingInput = encoder.encode(`${encodedProtectedHeader}.${encodedPayload}`));
  }
  signingInput ??= concat(encode(encodedProtectedHeader), encode("."), signingPayload);
  const signingKey = await rawKey(await prepareKey(entry, key, "sign"), entry.subtle, "sign");
  entry.minRsaBits && checkModulusLength(entry.alg, signingKey);
  const jws = {
    signature: encode2(new Uint8Array(await crypto.subtle.sign(entry.signing, signingKey, signingInput))),
    payload: encodedPayload
  };
  return protectedHeader && (jws.protected = encodedProtectedHeader), unprotectedHeader && (jws.header = unprotectedHeader), [jws, b64];
}
async function createCompactSignature(payload, protectedHeader, crit, key, rejectUnencoded) {
  const [jws] = await createSignature([payload, protectedHeader, undefined, crit], key, rejectUnencoded);
  return `${jws.protected}.${jws.payload}.${jws.signature}`;
}

// node_modules/jose/dist/webapi/jwt/sign.js
var SignJWT_base = JWTClaimsBuilder;

class SignJWT extends SignJWT_base {
  #protectedHeader;
  setProtectedHeader(protectedHeader) {
    return assertNotSet(this.#protectedHeader, "setProtectedHeader"), this.#protectedHeader = protectedHeader, this;
  }
  async sign(key, options) {
    return createCompactSignature(jwtClaimsSetBytes(this), this.#protectedHeader, options?.crit, key, () => {
      throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
    });
  }
}

// node_modules/jose/dist/webapi/jwks/local.js
function isUsableJWK(jwk, entry, alg, kid) {
  const { kty, key_ops: keyOps, ext, kid: jwkKid, alg: jwkAlg, use, crv } = jwk;
  return (ext === undefined || typeof ext == "boolean") && (keyOps === undefined || Array.isArray(keyOps) && keyOps.every((operation, index) => typeof operation == "string" && keyOps.indexOf(operation) === index) && keyOps.includes("verify")) && entry.kty.includes(kty) && (kid === undefined || typeof kid == "string" && kid === jwkKid) && (jwkAlg === undefined ? kty !== "AKP" : alg === jwkAlg) && (use === undefined || use === "sig") && (!entry.crv || crv === entry.crv);
}
async function importWithAlgCache(cache, jwk, entry) {
  const cached = cache.get(jwk) || cache.set(jwk, {}).get(jwk), { alg } = entry;
  if (cached[alg] === undefined) {
    const pending = jwkToKey(entry, jwk, true).then((key) => {
      if (key.type !== "public")
        throw new JWKSInvalid("JSON Web Key Set members must be public keys");
      return cached[alg] = key, key;
    }).catch((error) => {
      throw cached[alg] === pending && delete cached[alg], error;
    });
    cached[alg] = pending;
  }
  return cached[alg];
}
function createLocalJWKSet(jwks) {
  let snapshot;
  try {
    snapshot = structuredClone(jwks);
  } catch (cause) {
    throw new JWKSInvalid("JSON Web Key Set malformed", { cause });
  }
  if (!isJwkSet(snapshot))
    throw new JWKSInvalid("JSON Web Key Set malformed");
  const metadata = snapshot.keys.map((jwk) => {
    const normalized = snapshotJwk(jwk);
    return Array.isArray(normalized.key_ops) && (normalized.key_ops = [...normalized.key_ops]), normalized;
  }), cached = /* @__PURE__ */ new WeakMap;
  return Object.defineProperty(async (protectedHeader, token) => {
    const { alg, kid } = { ...protectedHeader, ...token?.header }, entry = typeof alg == "string" ? JWS[alg] : undefined;
    if (!entry || entry.secret)
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
    const candidates = snapshot.keys.filter((_, index) => isUsableJWK(metadata[index], entry, alg, kid)), { 0: jwk, length } = candidates;
    if (!length)
      throw new JWKSNoMatchingKey;
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys;
      throw error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates)
          try {
            yield await importWithAlgCache(cached, jwk2, entry);
          } catch {}
      }, error;
    }
    return importWithAlgCache(cached, jwk, entry);
  }, "jwks", {
    value: () => structuredClone(snapshot)
  });
}

// node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair < "u" || typeof navigator < "u" && navigator.userAgent === "Cloudflare-Workers" || typeof EdgeRuntime < "u" && EdgeRuntime === "vercel";
}
var USER_AGENT;
(typeof navigator > "u" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) && (USER_AGENT = "jose/v6.2.13");
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    throw err.name === "TimeoutError" ? new JWKSTimeout(undefined, { cause: err }) : err;
  });
  if (response.status !== 200)
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  try {
    return await response.json();
  } catch (cause) {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON", { cause });
  }
}
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshFor(timestamp, duration) {
  return Number.isFinite(timestamp) && Date.now() < timestamp + duration;
}
function validateDuration(value, fallback, option) {
  if (Number.isNaN(value))
    throw new TypeError(`"${option}" option must not be NaN`);
  return typeof value == "number" ? value : fallback;
}
function createRemoteJWKSet(url, options) {
  if (!(url instanceof URL))
    throw new TypeError("url must be an instance of URL");
  const href = new URL(url.href).href, opts = options ?? {}, timeoutOption = opts.timeoutDuration;
  if (typeof timeoutOption == "number" && (!Number.isInteger(timeoutOption) || timeoutOption < 0))
    throw new TypeError('"timeoutDuration" option must be a non-negative integer');
  const timeoutDuration = typeof timeoutOption == "number" ? timeoutOption : 5000, cooldownDuration = validateDuration(opts.cooldownDuration, 30000, "cooldownDuration"), cacheMaxAge = validateDuration(opts.cacheMaxAge, 600000, "cacheMaxAge"), headers = new Headers(opts.headers);
  USER_AGENT && !headers.has("User-Agent") && headers.set("User-Agent", USER_AGENT), headers.has("accept") || headers.set("accept", "application/json, application/jwk-set+json");
  const fetchImpl = opts[customFetch], cache = opts[jwksCache];
  let jwksTimestamp, pendingFetch, reloadSequence = 0, appliedSequence = 0, local;
  if (cache && typeof cache == "object") {
    const { uat, jwks } = cache;
    isFreshFor(uat, cacheMaxAge) && isJwkSet(jwks) && (jwksTimestamp = uat, local = createLocalJWKSet(jwks));
  }
  const reload = async () => {
    if (pendingFetch && isCloudflareWorkers() && (pendingFetch = undefined), !pendingFetch) {
      const sequence = ++reloadSequence, current = pendingFetch = fetchJwks(href, headers, AbortSignal.timeout(timeoutDuration), fetchImpl).then((json) => {
        const next = createLocalJWKSet(json);
        if (sequence <= appliedSequence)
          return;
        local = next;
        const updatedAt = Date.now();
        cache && (cache.uat = updatedAt, cache.jwks = json), jwksTimestamp = updatedAt, appliedSequence = sequence;
      }).finally(() => {
        pendingFetch === current && (pendingFetch = undefined);
      });
    }
    await pendingFetch;
  };
  return Object.defineProperties(async (protectedHeader, token) => {
    (!local || !isFreshFor(jwksTimestamp, cacheMaxAge)) && await reload();
    try {
      return await local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey && !isFreshFor(jwksTimestamp, cooldownDuration))
        return await reload(), local(protectedHeader, token);
      throw err;
    }
  }, {
    coolingDown: {
      get: () => isFreshFor(jwksTimestamp, cooldownDuration),
      enumerable: true
    },
    fresh: {
      get: () => isFreshFor(jwksTimestamp, cacheMaxAge),
      enumerable: true
    },
    reload: {
      value: reload,
      enumerable: true
    },
    reloading: {
      get: () => !!pendingFetch,
      enumerable: true
    },
    jwks: {
      value: () => local?.jwks(),
      enumerable: true
    }
  });
}

// src/jurnal/stockbit.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
var kunciStockbit = (jenis) => ({
  session: `jurnal:stockbit:${jenis}:sesi`,
  snapshot: `jurnal:stockbit:${jenis}:snapshot`,
  lock: `jurnal:stockbit:${jenis}:lock`
});
var STOCKBIT_KEYS = kunciStockbit("virtual");
var key = (secret) => createHash("sha256").update("jurnal-stockbit-v1:" + secret).digest();
function segelSesi(secret, sesi, jenis = "virtual") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(jenis));
  const data = Buffer.concat([cipher.update(JSON.stringify(sesi)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
function bukaSesi(secret, sealed, jenis = "virtual") {
  const b = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), b.subarray(0, 12));
  decipher.setAAD(Buffer.from(jenis));
  decipher.setAuthTag(b.subarray(12, 28));
  const s = JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString());
  if (typeof s.access !== "string" || !s.access || typeof s.refresh !== "string" || !s.refresh || !Number.isFinite(s.expiresAt))
    throw Error("Sesi tidak sah");
  return s;
}
var obj = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Format Stockbit berubah");
  return v;
};
var angka = (v) => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : null;
var wajib = (v) => {
  const n = angka(v);
  if (n === null)
    throw Error("Angka Stockbit tidak terbaca");
  return n;
};
var teks = (v) => {
  if (typeof v !== "string" && typeof v !== "number")
    throw Error("Teks Stockbit tidak terbaca");
  return String(v);
};
var payload = (v) => {
  const b = obj(v);
  if (b.error || b.error_type || b.success === false)
    throw Error("Stockbit menolak permintaan");
  const d = b.data;
  if (d && !Array.isArray(d) && typeof d === "object" && "data" in d)
    return payload(d);
  return d;
};
function tokenDalam(v, kind, depth = 0) {
  if (!v || typeof v !== "object" || depth > 8)
    return;
  for (const [k, child] of Object.entries(v)) {
    if ([kind, kind + "_token", kind + "Token"].includes(k)) {
      if (typeof child === "string" && child)
        return { token: child };
      if (child && typeof child === "object" && typeof child.token === "string")
        return child;
    }
    const nested = tokenDalam(child, kind, depth + 1);
    if (nested)
      return nested;
  }
}
var rows = (v) => {
  const xs = Array.isArray(v) ? v : obj(v).list ?? obj(v).result ?? obj(v).results;
  if (!Array.isArray(xs))
    throw Error("Daftar Stockbit tidak terbaca");
  return xs.map(obj);
};
function normalisasi(jenis, porto, orders, summary, now) {
  const p = payload(porto);
  const totals = jenis === "virtual" ? obj(p) : obj(payload(summary)).aggregated_portfolio_summary ?? obj(payload(summary));
  const positions = rows(jenis === "virtual" ? obj(p).result : p).map((r) => {
    const virtual = jenis === "virtual";
    const kode = teks(r.symbol ?? r.stock_code);
    if (!/^[A-Z0-9.-]{2,15}$/.test(kode))
      throw Error("Kode Stockbit tidak terbaca");
    const lot = wajib(virtual ? r.balance_lot : r.qty?.balance?.lot ?? r.lot);
    if (lot < 0)
      throw Error("Lot Stockbit tidak sah");
    return {
      kode,
      lot,
      average: angka(virtual ? r.price?.average : r.price?.average?.price),
      market: angka(virtual ? r.price?.market : r.price?.latest),
      marketValue: angka(virtual ? r.unrealized?.market_value : r.asset?.unrealised?.market_value),
      pnl: angka(virtual ? r.unrealized?.profit_loss : r.asset?.unrealised?.profit_loss)
    };
  });
  const os = rows(payload(orders)).map((r) => ({
    id: teks(r.id ?? r.order_id),
    kode: teks(r.symbol ?? r.stock_code),
    side: teks(jenis === "virtual" ? r.action : r.side ?? r.action),
    status: teks(r.status_text ?? r.status),
    lot: angka(jenis === "virtual" ? r.total : r.qty?.lot_total ?? r.lot),
    matchedLot: jenis === "virtual" ? angka(r.done) : angka(r.qty?.lot_done) ?? (angka(r.done) === null ? null : wajib(r.done) / 100),
    price: angka(jenis === "virtual" ? r.price : r.price?.order ?? r.price),
    createdAt: typeof r.time_utc?.order === "string" ? r.time_utc.order : typeof r.time?.created === "string" ? r.time.created : typeof r.created_at === "string" ? r.created_at : null
  }));
  const balance = angka(jenis === "virtual" ? totals.trading_balance : totals.trading?.balance);
  const unrealized = angka(jenis === "virtual" ? totals.profit_loss?.unrealized : totals.profit_loss?.unrealised);
  if (balance === null && unrealized === null)
    throw Error("Ringkasan Stockbit tidak terbaca");
  return {
    jenis,
    syncedAt: new Date(now).toISOString(),
    balance,
    unrealized,
    realized: angka(jenis === "virtual" ? totals.profit_loss?.realized : totals.profit_loss?.realised),
    positions,
    orders: os
  };
}
async function sinkronStockbit(redis, secret, fetcher = fetch, now = Date.now(), jenis = "virtual") {
  const keys = kunciStockbit(jenis);
  const saved = await redis(["GET", keys.snapshot]);
  const snapshot = saved ? JSON.parse(saved) : null;
  const result = (warning) => ({ snapshot, warning });
  if (snapshot && now - Date.parse(snapshot.syncedAt) < 60000)
    return result(null);
  const lock = randomBytes(24).toString("hex");
  if (await redis(["SET", keys.lock, lock, "NX", "PX", 45000]) !== "OK")
    return result("Sinkronisasi sedang berjalan. Coba muat ulang sebentar lagi.");
  try {
    const sealed = await redis(["GET", keys.session]);
    if (!sealed)
      return result(`Stockbit ${jenis === "real" ? "Real" : "Virtual"} belum dihubungkan.`);
    let sesi = bukaSesi(secret, sealed, jenis);
    const origin = jenis === "virtual" ? "https://exodus.stockbit.com" : "https://carina.stockbit.com";
    const request = async (path, token, refresh = false) => {
      const res = await fetcher(origin + path, {
        method: refresh ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          origin: "https://stockbit.com",
          referer: "https://stockbit.com/",
          authorization: `Bearer ${token}`,
          ...refresh && jenis === "real" ? { "content-type": "application/json" } : {}
        },
        ...refresh && jenis === "real" ? { body: JSON.stringify({ refresh_token: token }) } : {}
      });
      if (!res.ok)
        throw Error("Stockbit tidak merespons");
      return res.json();
    };
    if (sesi.expiresAt <= now / 1000 + 60) {
      const d = obj(payload(await request(jenis === "virtual" ? "/login/refresh" : "/auth/refresh", sesi.refresh, true)));
      const a = tokenDalam(d, "access");
      const access = teks(a?.token ?? d.token);
      const refresh = teks(tokenDalam(d, "refresh")?.token ?? sesi.refresh);
      const expiry = d.expired_at ?? d.expires_at ?? a?.expired_at ?? a?.expires_at;
      const exp = angka(expiry) ?? (typeof expiry === "string" ? Date.parse(expiry) / 1000 : null) ?? angka(JSON.parse(Buffer.from(access.split(".")[1] ?? "", "base64url").toString()).exp);
      if (!exp || !Number.isFinite(exp) || exp <= now / 1000)
        throw Error("Masa sesi tidak terbaca");
      sesi = { access, refresh, expiresAt: exp };
      await redis(["SET", keys.session, segelSesi(secret, sesi, jenis)]);
    }
    const [porto, orders, summary] = await Promise.all([
      request(jenis === "virtual" ? "/virtualtrading/portfolio" : "/portfolio/v2/list", sesi.access),
      request(jenis === "virtual" ? "/virtualtrading/order" : "/order/v2/list", sesi.access),
      jenis === "real" ? request("/portfolio/v2/summary", sesi.access) : Promise.resolve(null)
    ]);
    const fresh = normalisasi(jenis, porto, orders, summary, now);
    await redis(["SET", keys.snapshot, JSON.stringify(fresh)]);
    return { snapshot: fresh, warning: null };
  } catch {
    return result("Stockbit belum bisa disinkronkan. Coba lagi; jika tetap gagal, sambungkan ulang sesi Stockbit. Data terakhir tetap ditampilkan.");
  } finally {
    await redis(["EVAL", 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, keys.lock, lock]);
  }
}

// src/jurnal/api.ts
var KEY = "jurnal:entri";
var COOKIE = "jurnal_sesi";
var CHALLENGE = "jurnal_google";
var keys = new WeakMap;
var UMUR_SESI = 180 * 86400;
var ID = /^[a-z0-9-]{8,40}$/;
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
var gagal = (status, pesan) => json({ pesan }, status);
var tokenSesi = (kunci) => createHmac("sha256", kunci).update("jurnal-sesi-v1").digest("base64url");
function sama(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function cookieSesi(req, nama = COOKIE) {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${nama}=([^;]*)`));
  return m?.[1] ?? null;
}
var setCookie = (nilai, umur) => `${COOKIE}=${nilai}; Path=/api/jurnal; Max-Age=${umur}; HttpOnly; Secure; SameSite=Strict`;
var cookieGoogle = (nilai, umur) => `${CHALLENGE}=${nilai}; Path=/api/jurnal; Max-Age=${umur}; HttpOnly; Secure; SameSite=None`;
async function tokenGoogle(kunci, email, subject, umur, nonce) {
  return new SignJWT({ email, ...nonce ? { nonce } : {} }).setProtectedHeader({ alg: "HS256" }).setIssuer("jurnal").setAudience(nonce ? "google-challenge" : "jurnal-sesi").setSubject(subject).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + umur).sign(new TextEncoder().encode(kunci));
}
async function bacaToken(token, kunci, audience) {
  return (await jwtVerify(token, new TextEncoder().encode(kunci), {
    algorithms: ["HS256"],
    issuer: "jurnal",
    audience,
    requiredClaims: ["exp", "iat", "sub", "email"]
  })).payload;
}
async function masukGoogle(req, env, body, fetcher) {
  try {
    const challenge = cookieSesi(req, CHALLENGE);
    if (!challenge || typeof body.credential !== "string" || body.credential.length > 16384)
      return gagal(401, "Ulangi masuk dengan Google.");
    const proof = await bacaToken(challenge, env.JURNAL_KUNCI, "google-challenge");
    if (proof.email !== env.JURNAL_EMAIL)
      return gagal(401, "Ulangi masuk dengan Google.");
    let jwks = keys.get(fetcher);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { [customFetch]: fetcher });
      keys.set(fetcher, jwks);
    }
    const { payload } = await jwtVerify(body.credential, jwks, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID,
      requiredClaims: ["exp", "iat", "sub", "email", "nonce"]
    });
    if (typeof proof.nonce !== "string" || payload.nonce !== proof.nonce)
      return gagal(401, "Ulangi masuk dengan Google.");
    if (payload.email_verified !== true || payload.email !== env.JURNAL_EMAIL)
      return gagal(403, "Akun ini tidak memiliki akses jurnal.");
    const umur = 30 * 86400;
    const token = await tokenGoogle(env.JURNAL_KUNCI, env.JURNAL_EMAIL, payload.sub, umur);
    const headers = new Headers({ "cache-control": "no-store" });
    headers.append("set-cookie", setCookie(token, umur));
    headers.append("set-cookie", cookieGoogle("", 0));
    return new Response(null, { status: 204, headers });
  } catch {
    return gagal(401, "Login Google belum berhasil. Coba lagi.");
  }
}
function tanggalSah(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s))
    return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
var bulat = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
function validasi(x) {
  if (typeof x !== "object" || x === null)
    return null;
  const e = x;
  const beli = e.beli;
  const jual = e.jual;
  if (typeof e.id !== "string" || !ID.test(e.id))
    return null;
  if (typeof e.kode !== "string" || !/^[A-Z]{4}$/.test(e.kode))
    return null;
  if (e.rencana !== null && !tanggalSah(e.rencana))
    return null;
  if (!beli || !tanggalSah(beli.tanggal) || !bulat(beli.harga, 1, 1e7) || !bulat(beli.lot, 1, 1e6))
    return null;
  if (jual != null && (!tanggalSah(jual.tanggal) || !bulat(jual.harga, 1, 1e7) || jual.tanggal < beli.tanggal))
    return null;
  if (typeof e.catatan !== "string" || e.catatan.length > 500)
    return null;
  return {
    id: e.id,
    kode: e.kode,
    rencana: e.rencana,
    beli: { tanggal: beli.tanggal, harga: beli.harga, lot: beli.lot },
    jual: jual == null ? null : { tanggal: jual.tanggal, harga: jual.harga },
    catatan: e.catatan
  };
}
async function redis(env, fetcher, perintah) {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token)
    throw new Error("penyimpanan belum disambungkan");
  const res = await fetcher(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(perintah)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error)
    throw new Error(`Redis: ${body.error ?? res.status}`);
  return body.result;
}
async function tangani(req, env = process.env, fetcher = fetch) {
  const kunci = env.JURNAL_KUNCI;
  if (!kunci || kunci.length < 32)
    return gagal(503, "JURNAL_KUNCI belum disetel di Vercel.");
  const google = !!(env.GOOGLE_CLIENT_ID || env.JURNAL_EMAIL);
  if (google && (!env.GOOGLE_CLIENT_ID || !env.JURNAL_EMAIL))
    return gagal(503, "Konfigurasi login Google belum lengkap.");
  const aksi = new URL(req.url).searchParams.get("aksi");
  if (req.method === "GET" && aksi === "konfigurasi") {
    if (!google)
      return json({ mode: "kunci" });
    const nonce = randomBytes2(32).toString("base64url");
    const proof = await tokenGoogle(kunci, env.JURNAL_EMAIL, "challenge", 600, nonce);
    return json({ mode: "google", clientId: env.GOOGLE_CLIENT_ID, nonce }, 200, { "set-cookie": cookieGoogle(proof, 600) });
  }
  if (google && req.method === "POST" && aksi === "google" && (req.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const form = new URLSearchParams(text);
    const csrf = cookieSesi(req, "g_csrf_token");
    const bodyCsrf = form.get("g_csrf_token");
    const result = text.length <= 24000 && csrf && bodyCsrf && sama(csrf, bodyCsrf) ? await masukGoogle(req, env, Object.fromEntries(form), fetcher) : gagal(403, "Permintaan login tidak sah.");
    const headers = new Headers(result.headers);
    headers.delete("content-type");
    headers.set("location", result.status === 204 ? "/jurnal/" : result.status === 403 && csrf && bodyCsrf && sama(csrf, bodyCsrf) ? "/jurnal/?login=ditolak" : "/jurnal/?login=ulang");
    return new Response(null, { status: 303, headers });
  }
  if (google && req.method !== "GET" && req.headers.get("origin") !== new URL(req.url).origin)
    return gagal(403, "Asal permintaan tidak sah.");
  let body = {};
  if (req.method !== "GET") {
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
      return gagal(415, "Harus JSON.");
    const isi = await req.json().catch(() => null);
    if (typeof isi !== "object" || isi === null || Array.isArray(isi))
      return gagal(400, "JSON rusak.");
    body = isi;
  }
  if (google && req.method === "POST" && aksi === "google")
    return masukGoogle(req, env, body, fetcher);
  if (req.method === "POST" && aksi === "masuk") {
    if (google)
      return gagal(401, "Gunakan Masuk dengan Google.");
    if (typeof body.kunci !== "string" || !sama(body.kunci, kunci))
      return gagal(401, "Kunci salah.");
    return new Response(null, { status: 204, headers: { "set-cookie": setCookie(tokenSesi(kunci), UMUR_SESI) } });
  }
  if (req.method === "POST" && aksi === "keluar") {
    return new Response(null, { status: 204, headers: { "set-cookie": setCookie("", 0), "cache-control": "no-store" } });
  }
  const sesi = cookieSesi(req);
  if (!sesi)
    return gagal(401, "Belum masuk.");
  if (google) {
    try {
      const payload = await bacaToken(sesi, kunci, "jurnal-sesi");
      if (payload.email !== env.JURNAL_EMAIL)
        return gagal(401, "Belum masuk.");
    } catch {
      return gagal(401, "Belum masuk.");
    }
  } else if (!sama(sesi, tokenSesi(kunci)))
    return gagal(401, "Belum masuk.");
  try {
    if (req.method === "GET" && aksi === "stockbit") {
      const jenis = new URL(req.url).searchParams.get("jenis") ?? "virtual";
      if (jenis !== "virtual" && jenis !== "real")
        return gagal(400, "Jenis akun tidak sah.");
      return json(await sinkronStockbit((cmd) => redis(env, fetcher, cmd), kunci, fetcher, Date.now(), jenis));
    }
    if (req.method === "GET") {
      const flat = await redis(env, fetcher, ["HGETALL", KEY]) ?? [];
      const entri = [];
      for (let i = 1;i < flat.length; i += 2)
        entri.push(JSON.parse(flat[i]));
      entri.sort((a, b) => b.beli.tanggal.localeCompare(a.beli.tanggal) || a.kode.localeCompare(b.kode));
      return json({ entri });
    }
    if (req.method === "PUT") {
      const e = validasi(body.entri);
      if (!e || e.jual)
        return gagal(400, "Isian tidak sah.");
      const baru = await redis(env, fetcher, ["HSETNX", KEY, e.id, JSON.stringify(e)]);
      return json({ entri: e }, baru === 1 ? 201 : 409);
    }
    if (req.method === "PATCH") {
      if (typeof body.id !== "string" || !ID.test(body.id))
        return gagal(400, "id tidak sah.");
      const lama = await redis(env, fetcher, ["HGET", KEY, body.id]);
      if (!lama)
        return gagal(404, "Entri sudah dihapus.");
      const e = JSON.parse(lama);
      if (e.jual)
        return gagal(409, "Jual sudah dicatat.");
      const dijual = validasi({ ...e, jual: body.jual });
      if (!dijual?.jual)
        return gagal(400, "Isian tidak sah.");
      await redis(env, fetcher, ["HSET", KEY, dijual.id, JSON.stringify(dijual)]);
      return json({ entri: dijual });
    }
    if (req.method === "DELETE") {
      if (typeof body.id !== "string" || !ID.test(body.id))
        return gagal(400, "id tidak sah.");
      await redis(env, fetcher, ["HDEL", KEY, body.id]);
      return new Response(null, { status: 204 });
    }
  } catch (err) {
    return gagal(502, err instanceof Error ? err.message : "Penyimpanan gagal.");
  }
  return gagal(405, "Metode tidak didukung.");
}
var handler = (req) => tangani(req);
export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
  tangani,
  validasi
};
