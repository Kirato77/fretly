import { Buffer } from "node:buffer";
import { constants, createDecipheriv, createHash, generateKeyPairSync, publicDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signBundle } from "../scripts/sign-bundle";

// Same key format as Capgo's `key create` (RSA-2048, PKCS#1 PEM).
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});
const other = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "pkcs1", format: "pem" } });
const padding = constants.RSA_PKCS1_PADDING;

/** What the plugin does on the phone (CryptoCipher.swift): open the session key and checksum, decrypt, compare. */
function verifyLikeThePlugin(encrypted: Buffer, checksum: string, sessionKey: string, pubKey: string) {
  const [ivB64, keyB64] = sessionKey.split(":");
  const aesKey = publicDecrypt({ key: pubKey, padding }, Buffer.from(keyB64, "base64"));
  const decipher = createDecipheriv("aes-128-cbc", aesKey, Buffer.from(ivB64, "base64"));
  const zip = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const signed = Buffer.from(checksum, "hex");
  expect(signed.length).toBe(256); // the plugin rejects anything else
  const expected = publicDecrypt({ key: pubKey, padding }, signed).toString("hex");
  return { zip, ok: expected === createHash("sha256").update(zip).digest("hex") };
}

describe("signBundle", () => {
  const zip = Buffer.from("PK\u0003\u0004 pretend this is the web bundle");

  it("produces a bundle the public key accepts", () => {
    const { encrypted, checksum, sessionKey } = signBundle(zip, privateKey);
    expect(encrypted.equals(zip)).toBe(false);
    const { zip: opened, ok } = verifyLikeThePlugin(encrypted, checksum, sessionKey, publicKey);
    expect(opened.equals(zip)).toBe(true);
    expect(ok).toBe(true);
  });

  it("is rejected with another key", () => {
    const { encrypted, checksum, sessionKey } = signBundle(zip, privateKey);
    expect(() => verifyLikeThePlugin(encrypted, checksum, sessionKey, other.publicKey)).toThrow();
  });

  it("detects a tampered checksum", () => {
    const { encrypted, sessionKey } = signBundle(zip, privateKey);
    const forged = signBundle(Buffer.from("PK\u0003\u0004 evil"), privateKey).checksum;
    expect(verifyLikeThePlugin(encrypted, forged, sessionKey, publicKey).ok).toBe(false);
  });
});
