import express from "express";
import helmet from "helmet";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, jwtVerify } from "jose";
import QRCode from "qrcode";
import { createStore } from "./store.js";
import {
  randomToken,
  digest,
  otp,
  protectOtp,
  equal,
  hashPassword,
  verifyPassword,
  validPassword,
  encrypt,
  decrypt,
  newTotp,
  totpFromSecret,
} from "./security.js";

const MINUTE = 60_000;
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  emailVerified: !!user.email_verified,
  phoneVerified: !!user.phone_verified,
  mfaEnabled: !!user.mfa_enabled,
  mfaMethod: user.mfa_method,
});
const failure = (status, code, error, extra = {}) => ({
  status,
  body: { error, code, ...extra },
});
const success = (body) => ({ status: 200, body });
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((item) => {
        const i = item.indexOf("=");
        return [item.slice(0, i).trim(), item.slice(i + 1)];
      }),
  );
const text = (value) => (typeof value === "string" ? value.trim() : "");

export async function createApp(options = {}) {
  const production =
    options.production ??
    (process.env.NODE_ENV === "production" || !!process.env.VERCEL);
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  let secret = options.secret || process.env.APP_SECRET;
  let jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
  if (
    production &&
    (!databaseUrl ||
      !secret ||
      secret.length < 32 ||
      !jwtSecret ||
      jwtSecret.length < 32 ||
      secret === jwtSecret)
  ) {
    throw new Error(
      "Production requires DATABASE_URL and distinct APP_SECRET/JWT_SECRET values of at least 32 characters.",
    );
  }
  if (!secret || !jwtSecret) {
    mkdirSync("data", { recursive: true });
    const path = "data/development-secrets.json";
    if (!existsSync(path))
      writeFileSync(
        path,
        JSON.stringify({ secret: randomToken(), jwtSecret: randomToken() }),
        { mode: 0o600 },
      );
    const development = JSON.parse(readFileSync(path, "utf8"));
    secret ||= development.secret;
    jwtSecret ||= development.jwtSecret;
  }
  const store =
    options.store ||
    (await createStore({ databaseUrl, filename: options.filename }));
  const now = options.now || Date.now;
  const delivery =
    options.delivery ||
    (({ channel, to, code }) =>
      console.log(
        `[SIMULATED ${channel.toUpperCase()}]\nTo: ${to}\nOTP: ${code}`,
      ));
  const origin =
    options.origin ||
    process.env.APP_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  const sessionCookie = production
    ? "__Host-secureid_session"
    : "secureid_session";
  const flowCookie = production ? "__Host-secureid_flow" : "secureid_flow";
  const jwtKey = new TextEncoder().encode(jwtSecret);
  const dummyPassword = await hashPassword(randomToken());
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "8kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET") {
      if (!req.is("application/json"))
        return res
          .status(415)
          .json({ error: "JSON is required.", code: "JSON_REQUIRED" });
      if (
        req.get("Sec-Fetch-Site") === "cross-site" ||
        (req.get("Origin") && req.get("Origin") !== origin)
      )
        return res
          .status(403)
          .json({
            error: "Request origin not allowed.",
            code: "ORIGIN_DENIED",
          });
    }
    next();
  });
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
  };
  function setCookie(res, name, token, maxAge) {
    res.cookie(name, token, {
      ...cookieOptions,
      ...(maxAge ? { maxAge } : {}),
    });
  }
  function clearCookie(res, name) {
    res.clearCookie(name, cookieOptions);
  }
  async function readFlow(db, req, purpose) {
    const token = cookies(req)[flowCookie];
    if (!token) return undefined;
    const flow = await db.get("SELECT * FROM flows WHERE id=$1", [
      digest(token),
    ]);
    return flow &&
      Number(flow.expires_at) > now() &&
      (!purpose || flow.purpose === purpose)
      ? flow
      : undefined;
  }
  async function readSession(db, req) {
    const token = cookies(req)[sessionCookie];
    if (!token) return undefined;
    return db.get("SELECT * FROM sessions WHERE id=$1 AND expires_at>$2", [
      digest(token),
      now(),
    ]);
  }
  async function createFlow(db, res, userId, purpose, stage, remember = false) {
    const token = randomToken(),
      id = digest(token);
    await db.run(
      "INSERT INTO flows (id,user_id,purpose,stage,expires_at,remember_me) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, userId, purpose, stage, now() + 30 * MINUTE, remember ? 1 : 0],
    );
    setCookie(res, flowCookie, token, 30 * MINUTE);
    return db.get("SELECT * FROM flows WHERE id=$1", [id]);
  }
  async function rate(db, key, max = 20, window = 15 * MINUTE) {
    const id = digest(key),
      entry = await db.get("SELECT * FROM rate_limits WHERE id=$1", [id]);
    if (!entry || Number(entry.expires_at) <= now()) {
      await db.run(
        "INSERT INTO rate_limits (id,hits,expires_at) VALUES ($1,1,$2) ON CONFLICT (id) DO UPDATE SET hits=1,expires_at=$2",
        [id, now() + window],
      );
      return true;
    }
    if (entry.hits >= max) return false;
    await db.run("UPDATE rate_limits SET hits=hits+1 WHERE id=$1", [id]);
    return true;
  }
  async function issue(db, flow, user, channel) {
    if (flow.failures >= 10)
      return failure(
        429,
        "FLOW_LOCKED",
        "Too many attempts. Please start again later.",
      );
    if (flow.sends >= 10)
      return failure(
        429,
        "SEND_LIMIT",
        "Too many codes requested. Please try again later.",
      );
    const wait = Math.ceil((Number(flow.last_sent) + 30_000 - now()) / 1000);
    if (wait > 0)
      return failure(
        429,
        "RESEND_COOLDOWN",
        "Please wait before requesting another code.",
        { retryAfter: wait },
      );
    // The account-wide budget survives new flows and cannot be reset by refreshing.
    if (!(await rate(db, `send:${user.id}`, 15, 30 * MINUTE)))
      return failure(
        429,
        "SEND_LIMIT",
        "Too many codes requested. Please try again later.",
      );
    const id = randomToken(),
      code = otp(),
      expiresAt = now() + 3 * MINUTE;
    await db.run("UPDATE challenges SET consumed=1 WHERE flow_id=$1", [
      flow.id,
    ]);
    await db.run(
      "INSERT INTO challenges (id,flow_id,channel,otp_hash,expires_at) VALUES ($1,$2,$3,$4,$5)",
      [id, flow.id, channel, protectOtp(secret, id, code), expiresAt],
    );
    await db.run("UPDATE flows SET sends=sends+1,last_sent=$1 WHERE id=$2", [
      now(),
      flow.id,
    ]);
    await delivery({
      channel,
      to: channel === "email" ? user.email : user.phone,
      code,
    });
    return success({
      challengeId: id,
      method: channel,
      expiresAt,
      resendAt: now() + 30_000,
    });
  }
  async function verifyChallenge(db, req, flow, channels) {
    if (flow.failures >= 10)
      return failure(
        429,
        "FLOW_LOCKED",
        "Too many attempts. Please start again later.",
      );
    const challenge = await db.get(
      "SELECT * FROM challenges WHERE id=$1 AND flow_id=$2",
      [text(req.body.challengeId), flow.id],
    );
    if (
      !challenge ||
      !channels.includes(challenge.channel) ||
      challenge.consumed
    )
      return failure(
        400,
        "INVALID_CHALLENGE",
        "This code is no longer valid. Request a new code.",
      );
    if (challenge.attempts >= 3)
      return failure(
        429,
        "MAX_ATTEMPTS",
        "Maximum attempts reached. Please request a new code.",
        { attemptsLeft: 0 },
      );
    if (Number(challenge.expires_at) <= now())
      return failure(410, "OTP_EXPIRED", "This code has expired.");
    if (!/^\d{6}$/.test(text(req.body.code)))
      return failure(400, "INVALID_CODE", "Enter all 6 digits.");
    if (!(await rate(db, `verify:${flow.user_id}`, 20)))
      return failure(
        429,
        "FLOW_LOCKED",
        "Too many attempts. Please try again later.",
      );
    if (
      !equal(
        challenge.otp_hash,
        protectOtp(secret, challenge.id, req.body.code),
      )
    ) {
      await db.run("UPDATE challenges SET attempts=attempts+1 WHERE id=$1", [
        challenge.id,
      ]);
      await db.run("UPDATE flows SET failures=failures+1 WHERE id=$1", [
        flow.id,
      ]);
      const attemptsLeft = 2 - challenge.attempts;
      return failure(
        attemptsLeft ? 400 : 429,
        attemptsLeft ? "WRONG_OTP" : "MAX_ATTEMPTS",
        attemptsLeft
          ? "Incorrect code. Please try again."
          : "Maximum attempts reached. Please request a new code.",
        { attemptsLeft },
      );
    }
    await db.run("UPDATE challenges SET consumed=1 WHERE id=$1", [
      challenge.id,
    ]);
    return undefined;
  }
  const expiredFlow = () =>
    failure(
      401,
      "FLOW_EXPIRED",
      "Your verification journey has expired. Please start again.",
    );
  const endpoint = (path, fn, method = "post") =>
    app[method](path, async (req, res, next) => {
      try {
        // Expected security failures are values, not exceptions: failed attempt
        // counters must COMMIT even when the response is a 4xx.
        const result = await store.transaction((db) => fn(db, req, res));
        if (result.body?.retryAfter)
          res.set("Retry-After", String(result.body.retryAfter));
        res.status(result.status).json(result.body);
      } catch (error) {
        next(error);
      }
    });
  app.get("/api/config", (_req, res) =>
    res.json({
      googleEnabled: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
    }),
  );
  endpoint("/api/register", async (db, req, res) => {
    const name = text(req.body.name),
      email = text(req.body.email).toLowerCase(),
      phone = text(req.body.phone).replace(/[\s()-]/g, "");
    const password = req.body.password;
    if (
      name.length < 2 ||
      name.length > 80 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !/^\+[1-9]\d{7,14}$/.test(phone) ||
      !validPassword(password) ||
      req.body.termsAccepted !== true
    )
      return failure(
        400,
        "VALIDATION_ERROR",
        "Check your details, meet all password requirements, and accept the terms.",
      );
    if (!(await rate(db, `register:${req.ip}`, 15)))
      return failure(
        429,
        "RATE_LIMIT",
        "Too many registrations. Please try again later.",
      );
    const existing = await db.get("SELECT id FROM users WHERE email=$1", [
      email,
    ]);
    if (existing)
      return failure(
        409,
        "ACCOUNT_EXISTS",
        "This email already has an account. Log in to continue or finish verification.",
      );
    const id = randomToken();
    await db.run(
      "INSERT INTO users (id,name,email,phone,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, name, email, phone, await hashPassword(password), now()],
    );
    const user = await db.get("SELECT * FROM users WHERE id=$1", [id]);
    const flow = await createFlow(db, res, id, "registration", "email");
    const result = await issue(db, flow, user, "email");
    return {
      ...result,
      body: { ...result.body, next: "email", user: publicUser(user) },
    };
  });
  endpoint(
    "/api/journey",
    async (db, req) => {
      const flow = await readFlow(db, req);
      if (!flow) return expiredFlow();
      const user = await db.get("SELECT * FROM users WHERE id=$1", [
        flow.user_id,
      ]);
      const challenge = await db.get(
        "SELECT * FROM challenges WHERE flow_id=$1 AND consumed=0 ORDER BY expires_at DESC LIMIT 1",
        [flow.id],
      );
      return success({
        purpose: flow.purpose,
        stage: flow.stage,
        user: publicUser(user),
        availableMethods: user.totp_secret
          ? ["email", "sms", "authenticator"]
          : ["email", "sms"],
        ...(challenge
          ? {
              challengeId: challenge.id,
              method: challenge.channel,
              expiresAt: Number(challenge.expires_at),
              resendAt: Number(flow.last_sent) + 30_000,
              attemptsLeft: 3 - challenge.attempts,
            }
          : {}),
      });
    },
    "get",
  );
  for (const channel of ["email", "sms"]) {
    endpoint(`/api/send-${channel}-otp`, async (db, req) => {
      const flow = await readFlow(db, req, "registration");
      if (!flow) return expiredFlow();
      if (flow.stage !== channel)
        return failure(
          403,
          "WRONG_STAGE",
          "Complete the current verification step first.",
        );
      const user = await db.get("SELECT * FROM users WHERE id=$1", [
        flow.user_id,
      ]);
      return issue(db, flow, user, channel);
    });
    endpoint(`/api/verify-${channel}-otp`, async (db, req) => {
      const flow = await readFlow(db, req, "registration");
      if (!flow) return expiredFlow();
      if (flow.stage !== channel)
        return failure(
          403,
          "WRONG_STAGE",
          "Complete the current verification step first.",
        );
      const result = await verifyChallenge(db, req, flow, [channel]);
      if (result) return result;
      const next = channel === "email" ? "sms" : "setup";
      await db.run(
        `UPDATE users SET ${channel === "email" ? "email_verified" : "phone_verified"}=1 WHERE id=$1`,
        [flow.user_id],
      );
      // Email + SMS establish the required verified factors. Setup lets the user
      // choose their default factor or enroll a stronger authenticator factor.
      if (channel === "sms")
        await db.run(
          "UPDATE users SET mfa_enabled=1,mfa_method='email' WHERE id=$1",
          [flow.user_id],
        );
      await db.run("UPDATE flows SET stage=$1,last_sent=0 WHERE id=$2", [
        next,
        flow.id,
      ]);
      const user = await db.get("SELECT * FROM users WHERE id=$1", [
        flow.user_id,
      ]);
      if (channel === "email") {
        const updated = await db.get("SELECT * FROM flows WHERE id=$1", [
          flow.id,
        ]);
        const issued = await issue(db, updated, user, "sms");
        return {
          ...issued,
          body: { ...issued.body, next, user: publicUser(user) },
        };
      }
      return success({ next, user: publicUser(user) });
    });
  }
  endpoint("/api/change-phone", async (db, req) => {
    const flow = await readFlow(db, req, "registration");
    if (!flow || flow.stage !== "sms") return expiredFlow();
    const phone = text(req.body.phone).replace(/[\s()-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      return failure(
        400,
        "VALIDATION_ERROR",
        "Enter a valid mobile number including country code.",
      );
    const user = await db.get("SELECT * FROM users WHERE id=$1", [
      flow.user_id,
    ]);
    const issued = await issue(db, flow, { ...user, phone }, "sms");
    if (issued.status !== 200) return issued;
    await db.run("UPDATE users SET phone=$1 WHERE id=$2", [phone, user.id]);
    return success({ ...issued.body, user: publicUser({ ...user, phone }) });
  });
  endpoint("/api/mfa/setup", async (db, req) => {
    const flow = await readFlow(db, req, "registration");
    if (!flow || !["setup", "authenticator"].includes(flow.stage))
      return expiredFlow();
    const method = text(req.body.method);
    if (!["email", "sms", "authenticator"].includes(method))
      return failure(400, "INVALID_METHOD", "Choose a verification method.");
    const user = await db.get("SELECT * FROM users WHERE id=$1", [
      flow.user_id,
    ]);
    if (method === "authenticator") {
      const totp = flow.pending_totp
        ? totpFromSecret(decrypt(secret, flow.pending_totp))
        : newTotp(user.email);
      totp.label = user.email;
      await db.run(
        "UPDATE flows SET stage='authenticator',pending_totp=$1 WHERE id=$2",
        [encrypt(secret, totp.secret.base32), flow.id],
      );
      return success({
        next: "qr",
        setupKey: totp.secret.base32,
        qr: await QRCode.toDataURL(totp.toString(), {
          margin: 1,
          width: 200,
          errorCorrectionLevel: "M",
        }),
      });
    }
    await db.run("UPDATE users SET mfa_enabled=1,mfa_method=$1 WHERE id=$2", [
      method,
      user.id,
    ]);
    await db.run(
      "UPDATE flows SET stage='success',pending_totp=NULL WHERE id=$1",
      [flow.id],
    );
    return success({ next: "success" });
  });
  async function verifyTotp(db, flow, user, code, enrollment = false) {
    if (flow.failures >= 5)
      return failure(
        429,
        "FLOW_LOCKED",
        "Too many attempts. Please start again.",
      );
    if (!/^\d{6}$/.test(text(code)))
      return failure(400, "INVALID_CODE", "Enter all 6 digits.");
    if (!(await rate(db, `totp:${user.id}`, 15)))
      return failure(
        429,
        "FLOW_LOCKED",
        "Too many attempts. Please try again later.",
      );
    const encoded = enrollment ? flow.pending_totp : user.totp_secret;
    if (!encoded)
      return failure(
        400,
        "INVALID_METHOD",
        "Authenticator is not set up. Choose email or SMS.",
      );
    const totp = totpFromSecret(decrypt(secret, encoded));
    const delta = totp.validate({ token: code, timestamp: now(), window: 1 });
    const step = Math.floor(now() / 30_000) + (delta || 0);
    if (delta === null || step <= Number(user.last_totp_step)) {
      await db.run("UPDATE flows SET failures=failures+1 WHERE id=$1", [
        flow.id,
      ]);
      return failure(
        400,
        "WRONG_OTP",
        "Invalid or already used code. Please try the next code.",
        { attemptsLeft: 4 - flow.failures },
      );
    }
    await db.run("UPDATE users SET last_totp_step=$1 WHERE id=$2", [
      step,
      user.id,
    ]);
    return undefined;
  }
  endpoint("/api/mfa/verify", async (db, req) => {
    const flow = await readFlow(db, req, "registration");
    if (!flow || flow.stage !== "authenticator") return expiredFlow();
    const user = await db.get("SELECT * FROM users WHERE id=$1", [
      flow.user_id,
    ]);
    const result = await verifyTotp(db, flow, user, req.body.code, true);
    if (result) return result;
    await db.run(
      "UPDATE users SET totp_secret=$1,mfa_method='authenticator',mfa_enabled=1 WHERE id=$2",
      [flow.pending_totp, user.id],
    );
    await db.run(
      "UPDATE flows SET stage='success',pending_totp=NULL WHERE id=$1",
      [flow.id],
    );
    return success({ next: "success" });
  });
  endpoint("/api/login", async (db, req, res) => {
    const email = text(req.body.email).toLowerCase(),
      password = req.body.password;
    if (!email || typeof password !== "string" || password.length > 128)
      return failure(400, "VALIDATION_ERROR", "Enter your email and password.");
    if (!(await rate(db, `login-ip:${req.ip}`, 40)))
      return failure(
        429,
        "RATE_LIMIT",
        "Too many login attempts. Please try again later.",
      );
    const user = await db.get("SELECT * FROM users WHERE email=$1", [email]);
    const valid = await verifyPassword(
      password,
      user?.password_hash || dummyPassword,
    );
    if (user && Number(user.locked_until) > now())
      return failure(
        423,
        "ACCOUNT_LOCKED",
        "Account temporarily locked. Please try again in 15 minutes.",
      );
    if (!user || !valid) {
      if (user) {
        const attempts = user.login_failures + 1;
        await db.run(
          "UPDATE users SET login_failures=$1,locked_until=$2 WHERE id=$3",
          [
            attempts >= 5 ? 0 : attempts,
            attempts >= 5 ? now() + 15 * MINUTE : 0,
            user.id,
          ],
        );
        if (attempts >= 5)
          return failure(
            423,
            "ACCOUNT_LOCKED",
            "Account temporarily locked. Please try again in 15 minutes.",
          );
      }
      return failure(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password. Please try again.",
      );
    }
    await db.run(
      "UPDATE users SET login_failures=0,locked_until=0 WHERE id=$1",
      [user.id],
    );
    if (!user.email_verified || !user.phone_verified || !user.mfa_enabled) {
      const stage = !user.email_verified
        ? "email"
        : !user.phone_verified
          ? "sms"
          : "setup";
      const flow = await createFlow(db, res, user.id, "registration", stage);
      if (stage === "setup")
        return success({
          next: "setup",
          registrationRequired: true,
          user: publicUser(user),
        });
      const issued = await issue(db, flow, user, stage);
      return {
        ...issued,
        body: {
          ...issued.body,
          next: stage,
          registrationRequired: true,
          user: publicUser(user),
        },
      };
    }
    const flow = await createFlow(
      db,
      res,
      user.id,
      "login",
      "choose",
      req.body.rememberMe === true,
    );
    const issued = await issue(db, flow, user, "email");
    return {
      ...issued,
      body: {
        ...issued.body,
        mfaRequired: true,
        next: "choose",
        availableMethods: user.totp_secret
          ? ["email", "sms", "authenticator"]
          : ["email", "sms"],
        user: publicUser(user),
      },
    };
  });
  endpoint("/api/login/challenge", async (db, req) => {
    const flow = await readFlow(db, req, "login");
    if (!flow) return expiredFlow();
    const method = text(req.body.method),
      user = await db.get("SELECT * FROM users WHERE id=$1", [flow.user_id]);
    if (flow.failures >= 10)
      return failure(
        429,
        "FLOW_LOCKED",
        "Too many attempts. Please start again later.",
      );
    if (method === "authenticator") {
      if (!user.totp_secret)
        return failure(
          400,
          "INVALID_METHOD",
          "Authenticator is not set up for this account. Choose email or SMS.",
        );
      await db.run("UPDATE flows SET stage='authenticator' WHERE id=$1", [
        flow.id,
      ]);
      return success({
        next: "otp",
        method,
        expiresAt: (Math.floor(now() / 30_000) + 1) * 30_000,
      });
    }
    if (!["email", "sms"].includes(method))
      return failure(400, "INVALID_METHOD", "Choose a verification method.");
    if (!req.body.resend) {
      const challenge = await db.get(
        "SELECT * FROM challenges WHERE flow_id=$1 AND channel=$2 AND consumed=0 AND expires_at>$3 AND attempts<3 ORDER BY expires_at DESC LIMIT 1",
        [flow.id, method, now()],
      );
      if (challenge) {
        await db.run("UPDATE flows SET stage=$1 WHERE id=$2", [
          method,
          flow.id,
        ]);
        return success({
          next: "otp",
          method,
          challengeId: challenge.id,
          expiresAt: Number(challenge.expires_at),
          resendAt: Number(flow.last_sent) + 30_000,
        });
      }
    }
    // Switching delivery channels is still subject to the same resend budget.
    const issued = await issue(db, flow, user, method);
    if (issued.status === 200)
      await db.run("UPDATE flows SET stage=$1 WHERE id=$2", [method, flow.id]);
    return issued;
  });
  async function authenticate(db, req, res, flow, user) {
    const previous = cookies(req)[sessionCookie];
    if (previous)
      await db.run("DELETE FROM sessions WHERE id=$1", [digest(previous)]);
    const token = randomToken(),
      id = digest(token),
      csrf = randomToken();
    const duration = flow.remember_me ? 30 * 24 * 60 * MINUTE : 8 * 60 * MINUTE;
    await db.run(
      "INSERT INTO sessions (id,user_id,expires_at,csrf,created_at) VALUES ($1,$2,$3,$4,$5)",
      [id, user.id, now() + duration, csrf, now()],
    );
    await db.run("DELETE FROM challenges WHERE flow_id=$1", [flow.id]);
    await db.run("DELETE FROM flows WHERE id=$1", [flow.id]);
    setCookie(
      res,
      sessionCookie,
      token,
      flow.remember_me ? duration : undefined,
    );
    clearCookie(res, flowCookie);
    return success({
      authenticated: true,
      user: publicUser(user),
      csrfToken: csrf,
    });
  }
  endpoint("/api/verify-login-otp", async (db, req, res) => {
    const flow = await readFlow(db, req, "login");
    if (!flow || !["email", "sms", "authenticator"].includes(flow.stage))
      return expiredFlow();
    const user = await db.get("SELECT * FROM users WHERE id=$1", [
      flow.user_id,
    ]);
    const result =
      flow.stage === "authenticator"
        ? await verifyTotp(db, flow, user, req.body.code)
        : await verifyChallenge(db, req, flow, [flow.stage]);
    if (result) return result;
    return authenticate(db, req, res, flow, user);
  });
  endpoint(
    "/api/me",
    async (db, req) => {
      const session = await readSession(db, req);
      if (!session)
        return failure(401, "UNAUTHENTICATED", "Please log in to continue.");
      const user = await db.get("SELECT * FROM users WHERE id=$1", [
        session.user_id,
      ]);
      return success({
        user: publicUser(user),
        csrfToken: session.csrf,
        expiresAt: Number(session.expires_at),
      });
    },
    "get",
  );
  endpoint("/api/logout", async (db, req, res) => {
    const session = await readSession(db, req);
    if (session && !equal(req.get("X-CSRF-Token"), session.csrf))
      return failure(403, "CSRF_REQUIRED", "Refresh the page and try again.");
    if (session) await db.run("DELETE FROM sessions WHERE id=$1", [session.id]);
    const flow = await readFlow(db, req);
    if (flow) {
      await db.run("DELETE FROM challenges WHERE flow_id=$1", [flow.id]);
      await db.run("DELETE FROM flows WHERE id=$1", [flow.id]);
    }
    clearCookie(res, sessionCookie);
    clearCookie(res, flowCookie);
    return success({ loggedOut: true });
  });
  endpoint("/api/token", async (db, req) => {
    const session = await readSession(db, req);
    if (!session)
      return failure(401, "UNAUTHENTICATED", "Complete login and MFA first.");
    if (!equal(req.get("X-CSRF-Token"), session.csrf))
      return failure(403, "CSRF_REQUIRED", "Refresh the page and try again.");
    const issuedAt = Math.floor(now() / 1000),
      expiresAt = Math.min(
        issuedAt + 300,
        Math.floor(Number(session.expires_at) / 1000),
      );
    const accessToken = await new SignJWT({
      sid: session.id,
      scope: "profile:read",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(session.user_id)
      .setIssuer("secureid")
      .setAudience("secureid-api")
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomToken())
      .sign(jwtKey);
    return success({
      accessToken,
      tokenType: "Bearer",
      expiresIn: expiresAt - issuedAt,
    });
  });
  endpoint(
    "/api/protected",
    async (db, req) => {
      try {
        const authorization = req.get("Authorization") || "";
        if (!authorization.startsWith("Bearer "))
          throw new Error("Missing bearer token");
        const { payload } = await jwtVerify(authorization.slice(7), jwtKey, {
          algorithms: ["HS256"],
          issuer: "secureid",
          audience: "secureid-api",
          currentDate: new Date(now()),
          requiredClaims: ["sub", "sid", "exp", "iat", "jti"],
        });
        const session = await db.get(
          "SELECT * FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>$3",
          [payload.sid, payload.sub, now()],
        );
        if (!session) throw new Error("Session revoked");
        return success({
          message: "Access granted. Your JWT was verified.",
          user: publicUser(
            await db.get("SELECT * FROM users WHERE id=$1", [payload.sub]),
          ),
        });
      } catch {
        return failure(
          401,
          "INVALID_TOKEN",
          "Missing, expired, revoked, or invalid token.",
        );
      }
    },
    "get",
  );
  endpoint("/api/password/forgot", async (db, req, res) => {
    const email = text(req.body.email).toLowerCase();
    if (!(await rate(db, `reset:${req.ip}:${email}`, 5)))
      return failure(
        429,
        "RATE_LIMIT",
        "Too many requests. Please try again later.",
      );
    const user = await db.get("SELECT * FROM users WHERE email=$1", [email]);
    const generic = {
      message: "If an account exists, a reset code has been sent.",
      challengeId: randomToken(),
      method: "email",
      expiresAt: now() + 3 * MINUTE,
      resendAt: now() + 30_000,
    };
    if (user?.email_verified) {
      const flow = await createFlow(db, res, user.id, "reset", "email");
      const issued = await issue(db, flow, user, "email");
      if (issued.status === 200) return success({ ...generic, ...issued.body });
    }
    return success(generic);
  });
  endpoint("/api/password/reset", async (db, req, res) => {
    const flow = await readFlow(db, req, "reset");
    if (!flow)
      return failure(400, "WRONG_OTP", "Invalid or expired reset code.");
    if (!validPassword(req.body.password))
      return failure(
        400,
        "VALIDATION_ERROR",
        "Your new password must meet all password requirements.",
      );
    const result = await verifyChallenge(db, req, flow, ["email"]);
    if (result) return result;
    await db.run(
      "UPDATE users SET password_hash=$1,login_failures=0,locked_until=0 WHERE id=$2",
      [await hashPassword(req.body.password), flow.user_id],
    );
    // Password reset invalidates ALL sessions and pending login/registration/reset flows.
    await db.run("DELETE FROM sessions WHERE user_id=$1", [flow.user_id]);
    await db.run(
      "DELETE FROM challenges WHERE flow_id IN (SELECT id FROM flows WHERE user_id=$1)",
      [flow.user_id],
    );
    await db.run("DELETE FROM flows WHERE user_id=$1", [flow.user_id]);
    clearCookie(res, flowCookie);
    clearCookie(res, sessionCookie);
    return success({ passwordReset: true });
  });
  // Optional Google sign-in uses an authorization-code flow, PKCE, and state.
  // Google does not bypass this application's MFA or required phone verification.
  app.get("/api/auth/google", (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
      return res.redirect("/login?notice=google-unavailable");
    const state = randomToken(),
      verifier = randomToken();
    setCookie(
      res,
      "secureid_oauth",
      encrypt(
        secret,
        JSON.stringify({ state, verifier, expires: now() + 10 * MINUTE }),
      ),
      10 * MINUTE,
    );
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: Buffer.from(digest(verifier), "hex").toString(
        "base64url",
      ),
      code_challenge_method: "S256",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });
  app.get("/api/auth/google/callback", async (req, res, next) => {
    try {
      let saved;
      try {
        saved = JSON.parse(decrypt(secret, cookies(req).secureid_oauth || ""));
      } catch {
        return res.redirect("/login?notice=google-failed");
      }
      clearCookie(res, "secureid_oauth");
      if (
        !equal(text(req.query.state), saved.state) ||
        saved.expires < now() ||
        !text(req.query.code)
      )
        return res.redirect("/login?notice=google-failed");
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          code: req.query.code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${origin}/api/auth/google/callback`,
          grant_type: "authorization_code",
          code_verifier: saved.verifier,
        }),
      });
      if (!tokenResponse.ok) return res.redirect("/login?notice=google-failed");
      const tokens = await tokenResponse.json();
      const profileResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const profile = await profileResponse.json();
      if (!profileResponse.ok || !profile.email_verified || !profile.email)
        return res.redirect("/login?notice=google-failed");
      const found = await store.transaction(async (db) => {
        const user = await db.get("SELECT * FROM users WHERE email=$1", [
          profile.email.toLowerCase(),
        ]);
        if (
          !user ||
          !user.email_verified ||
          !user.phone_verified ||
          !user.mfa_enabled
        )
          return false;
        const flow = await createFlow(db, res, user.id, "login", "choose");
        await issue(db, flow, user, "email");
        return true;
      });
      return res.redirect(
        found ? "/login?resume=1" : "/register?notice=register-first",
      );
    } catch (error) {
      next(error);
    }
  });
  app.use("/api", (_req, res) =>
    res
      .status(404)
      .json({ error: "API endpoint not found.", code: "NOT_FOUND" }),
  );
  const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
  app.use(express.static(publicDir));
  app.get(
    ["/", "/register", "/login", "/dashboard", "/forgot-password"],
    (_req, res) => res.sendFile(resolve(publicDir, "index.html")),
  );
  app.use((error, _req, res, _next) => {
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: "Invalid JSON.", code: "INVALID_JSON" });
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({ error: "Request is too large.", code: "PAYLOAD_TOO_LARGE" });
    console.error("SecureID request failed:", error.message);
    res
      .status(500)
      .json({
        error: "Something went wrong. Please try again.",
        code: "SERVER_ERROR",
      });
  });
  return { app, store };
}
