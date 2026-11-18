import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** An encrypted secret as stored. Contains no plaintext. */
export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
  /** Which encryption secret sealed it (key rotation). */
  keyVersion: string;
}

interface Entry {
  version: string;
  key: Buffer;
}

/**
 * AES-256-GCM with versioned secrets. `KEY_ENCRYPTION_SECRET` is either one
 * secret (version "v1") or a list `v2:secretB,v1:secretA`: the first entry
 * seals new data, all entries can open old data. To rotate, put the new
 * secret first, then re-save keys (or run `reseal`) before dropping the old one.
 */
export class KeyCipher {
  private readonly entries: Entry[];

  constructor(raw: string) {
    this.entries = parseSecrets(raw).map(({ version, secret }) => ({
      version,
      key: Buffer.from(hkdfSync("sha256", secret, "openblah-key-store", "aes-256-gcm", 32)),
    }));
    if (this.entries.length === 0) throw new Error("KEY_ENCRYPTION_SECRET is empty");
  }

  get currentVersion(): string {
    return (this.entries[0] as Entry).version;
  }

  /** `aad` binds the ciphertext to its owner and provider so rows cannot be swapped. */
  seal(plaintext: string, aad: string): Sealed {
    const entry = this.entries[0] as Entry;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", entry.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      ciphertext: ct.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      keyVersion: entry.version,
    };
  }

  open(sealed: Sealed, aad: string): string {
    const entry = this.entries.find((e) => e.version === sealed.keyVersion);
    if (!entry) throw new Error("unknown encryption key version");
    const decipher = createDecipheriv("aes-256-gcm", entry.key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function parseSecrets(raw: string): { version: string; secret: string }[] {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1 && !/^[\w.-]+:/.test(parts[0] as string)) {
    return [{ version: "v1", secret: parts[0] as string }];
  }
  return parts.map((p) => {
    const i = p.indexOf(":");
    if (i <= 0) throw new Error("KEY_ENCRYPTION_SECRET entries must look like version:secret");
    return { version: p.slice(0, i), secret: p.slice(i + 1) };
  });
}
