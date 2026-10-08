import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

/** Hashes a staff PIN for storage in `staff.pin_hash`. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/** Verifies a PIN against a stored `salt:hash` value. */
export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{64}$/.test(hash ?? "")) return false;

  const candidate = scryptSync(pin, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");

  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  );
}

/** New/reset PINs: six to eight digits, excluding trivial repeats/sequences. */
export function validNewPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin) && !/^(\d)\1+$/.test(pin) &&
    !"01234567890123456789".includes(pin) && !"98765432109876543210".includes(pin);
}
