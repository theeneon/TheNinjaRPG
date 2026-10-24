import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  createOAuthState,
  decryptToken,
  encryptToken,
  OAUTH_STATE_TTL_MS,
  verifyOAuthState,
} from "@/server/utils/discord/secrets";

const SECRET = "client-secret";

describe("token encryption", () => {
  const key = randomBytes(32);

  it("round-trips and uses a fresh IV per value", () => {
    const first = encryptToken("access-token", key);
    const second = encryptToken("access-token", key);
    expect(first).not.toBe(second);
    expect(first.startsWith("v1.")).toBe(true);
    expect(first).not.toContain("access-token");
    expect(decryptToken(first, key)).toBe("access-token");
  });

  it("rejects a wrong key or tampered ciphertext", () => {
    const stored = encryptToken("refresh-token", key);
    expect(() => decryptToken(stored, randomBytes(32))).toThrow();
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."), key)).toThrow();
    expect(() => decryptToken("plain", key)).toThrow();
  });
});

describe("OAuth state", () => {
  const now = Date.UTC(2026, 9, 24);

  it("verifies for the same user, nonce and secret before expiry", () => {
    const { state, nonce } = createOAuthState("user-1", SECRET, now);
    expect(verifyOAuthState(state, { userId: "user-1", nonce, clientSecret: SECRET }, now + 1000)).toBe(true);
  });

  it("rejects expiry, another user, another browser, another secret and tampering", () => {
    const { state, nonce } = createOAuthState("user-1", SECRET, now);
    const expected = { userId: "user-1", nonce, clientSecret: SECRET };
    expect(verifyOAuthState(state, expected, now + OAUTH_STATE_TTL_MS + 1)).toBe(false);
    expect(verifyOAuthState(state, { ...expected, userId: "user-2" }, now)).toBe(false);
    expect(verifyOAuthState(state, { ...expected, nonce: "other-nonce" }, now)).toBe(false);
    expect(verifyOAuthState(state, { ...expected, nonce: undefined }, now)).toBe(false);
    expect(verifyOAuthState(state, { ...expected, clientSecret: "other" }, now)).toBe(false);
    const [body, signature] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ u: "user-2", n: nonce, e: now + OAUTH_STATE_TTL_MS }),
    ).toString("base64url");
    expect(verifyOAuthState(`${forged}.${signature}`, { ...expected, userId: "user-2" }, now)).toBe(false);
    expect(verifyOAuthState(body, expected, now)).toBe(false);
    expect(verifyOAuthState(null, expected, now)).toBe(false);
  });
});
