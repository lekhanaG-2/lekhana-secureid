import {
  randomBytes,
  randomInt,
  createHmac,
  createHash,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";

const scryptAsync = promisify(scrypt);
export const randomToken = () => randomBytes(32).toString("base64url");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const otp = () => randomInt(0, 1_000_000).toString().padStart(6, "0");
export const protectOtp = (secret, id, code) =>
  createHmac("sha256", secret).update(`${id}:${code}`).digest("hex");
export const equal = (a, b) => {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
};
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [, salt, hash] = encoded.split(":");
  return equal(
    (await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 })).toString(
      "hex",
    ),
    hash,
  );
}
export const validPassword = (value) =>
  typeof value === "string" &&
  value.length >= 8 &&
  value.length <= 128 &&
  /[A-Z]/.test(value) &&
  /[0-9]/.test(value) &&
  /[^A-Za-z0-9\s]/.test(value);
export function encrypt(secret, text) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(digest(secret), "hex"),
      iv,
    );
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((value) => value.toString("base64url"))
    .join(".");
}
export function decrypt(secret, text) {
  const [iv, tag, data] = text
    .split(".")
    .map((value) => Buffer.from(value, "base64url"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(digest(secret), "hex"),
    iv,
  );
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export const newTotp = (email) =>
  new OTPAuth.TOTP({
    issuer: "SecureID",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });
export const totpFromSecret = (secret) =>
  new OTPAuth.TOTP({
    issuer: "SecureID",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
