import { scrypt as deriveKey, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(deriveKey);
/** Encodes a randomly salted scrypt hash as salt:hash; never stores the plaintext PIN. */
export const hashParentalPin = async (pin: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(pin, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
};
/** Compares derived PIN hashes in constant time after checking equal byte lengths. */
export const verifyParentalPin = async (pin: string, stored: string) => {
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded) return false;
  const hash = (await scrypt(pin, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, "hex");
  return expected.length === hash.length && timingSafeEqual(expected, hash);
};
