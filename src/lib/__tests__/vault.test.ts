import { describe, expect, it } from "vitest";
import { decryptVault, encryptVault } from "../vault";

describe("vault", () => {
  it("round-trips a payload with the right passphrase", async () => {
    const payload = JSON.stringify({ hello: "world", n: 42 });
    const vault = await encryptVault(payload, "correct horse battery staple");
    expect(vault.startsWith("v1.")).toBe(true);
    // ciphertext is opaque — no plaintext leak
    expect(vault).not.toContain("world");
    const back = await decryptVault(vault, "correct horse battery staple");
    expect(JSON.parse(back)).toEqual({ hello: "world", n: 42 });
  });

  it("produces a different ciphertext every time (random IV)", async () => {
    const a = await encryptVault("same", "pw");
    const b = await encryptVault("same", "pw");
    expect(a).not.toBe(b);
  });

  it("fails on a wrong passphrase", async () => {
    const vault = await encryptVault("secret", "right");
    await expect(decryptVault(vault, "wrong")).rejects.toThrow();
  });

  it("rejects a tampered payload", async () => {
    const vault = await encryptVault("secret", "pw");
    const parts = vault.split(".");
    parts[3] = parts[3].slice(0, -2) + "AA"; // corrupt the ciphertext
    await expect(decryptVault(parts.join("."), "pw")).rejects.toThrow();
  });

  it("rejects unknown formats", async () => {
    await expect(decryptVault("v2.abc", "pw")).rejects.toThrow(/format/);
  });
});
