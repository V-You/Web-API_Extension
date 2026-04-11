import { describe, expect, it } from "vitest";

import { encrypt, decrypt } from "./crypto";

describe("crypto", () => {
  const pin = "1234";
  const secret = JSON.stringify({ baseUrl: "https://api.test", username: "u", password: "p" });

  it("round-trips encrypt -> decrypt", async () => {
    const blob = await encrypt(pin, secret);
    const result = await decrypt(pin, blob);
    expect(result).toBe(secret);
  });

  it("rejects wrong PIN", async () => {
    const blob = await encrypt(pin, secret);
    await expect(decrypt("wrong", blob)).rejects.toThrow();
  });

  it("produces different ciphertext each time (random salt and IV)", async () => {
    const blob1 = await encrypt(pin, secret);
    const blob2 = await encrypt(pin, secret);
    expect(blob1.salt).not.toBe(blob2.salt);
    expect(blob1.iv).not.toBe(blob2.iv);
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext);
  });

  it("returns a valid EncryptedBlob shape", async () => {
    const blob = await encrypt(pin, secret);
    expect(typeof blob.salt).toBe("string");
    expect(typeof blob.iv).toBe("string");
    expect(typeof blob.ciphertext).toBe("string");
    expect(blob.salt.length).toBeGreaterThan(0);
  });
});
