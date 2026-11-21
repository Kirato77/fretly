// Signs and encrypts the web bundle for @capgo/capacitor-updater ("encryption v2", hex checksum).
// Mirrors Capgo's CLI (github.com/Cap-go/CLI, src/api/crypto.ts) so the plugin, holding the public key
// from capacitor.config.ts, only installs bundles produced with the private key (GitHub secret).
//
// Usage (CI): BUNDLE_PRIVATE_KEY="$(cat key.pem)" node scripts/sign-bundle.ts bundle.zip
// Encrypts bundle.zip in place and prints {"checksum": …, "sessionKey": …} for latest.json.
import { Buffer } from "node:buffer";
import { constants, createCipheriv, createHash, privateEncrypt, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const padding = constants.RSA_PKCS1_PADDING;

export function signBundle(zip: Buffer, privateKey: string) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(zip), cipher.final()]);
  const sessionKey = `${iv.toString("base64")}:${privateEncrypt({ key: privateKey, padding }, aesKey).toString("base64")}`;
  // The plugin decrypts the zip, hashes it, and compares with this checksum opened by the public key.
  const sha256 = createHash("sha256").update(zip).digest();
  const checksum = privateEncrypt({ key: privateKey, padding }, sha256).toString("hex");
  return { encrypted, checksum, sessionKey };
}

if (process.argv[1]?.endsWith("sign-bundle.ts")) {
  const zipPath = process.argv[2];
  const privateKey = process.env.BUNDLE_PRIVATE_KEY;
  if (!zipPath || !privateKey) throw new Error("usage: BUNDLE_PRIVATE_KEY=<pem> node scripts/sign-bundle.ts <bundle.zip>");
  const { encrypted, checksum, sessionKey } = signBundle(readFileSync(zipPath), privateKey);
  writeFileSync(zipPath, encrypted);
  process.stdout.write(JSON.stringify({ checksum, sessionKey }));
}
