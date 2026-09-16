import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { SignJWT } from "jose";
import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";
import { totpFromSecret } from "../server/security.js";

const credentials = {
  name: "Priya Sharma",
  email: "priya.sharma@example.com",
  phone: "+919876543210",
  password: "Testing!123",
  termsAccepted: true,
};
const jwtSecret = "test-jwt-secret-32-characters-at-least-123";
async function fixture(t) {
  const store = await createStore({ filename: ":memory:" });
  let clock = Date.now();
  const messages = [];
  const { app } = await createApp({
    store,
    secret: "test-app-secret-32-characters-at-least-456",
    jwtSecret,
    now: () => clock,
    delivery: (message) => messages.push(message),
  });
  t.after(() => store.close());
  const agent = request.agent(app);
  return {
    app,
    store,
    agent,
    messages,
    tick: (ms) => {
      clock += ms;
    },
    now: () => clock,
    latest: () => messages.at(-1).code,
  };
}
async function register(f, method = "email") {
  const registration = await f.agent
    .post("/api/register")
    .send(credentials)
    .expect(200);
  const email = await f.agent
    .post("/api/verify-email-otp")
    .send({ challengeId: registration.body.challengeId, code: f.latest() })
    .expect(200);
  await f.agent
    .post("/api/verify-sms-otp")
    .send({ challengeId: email.body.challengeId, code: f.latest() })
    .expect(200);
  const setup = await f.agent
    .post("/api/mfa/setup")
    .send({ method })
    .expect(200);
  if (method === "authenticator") {
    await f.agent
      .post("/api/mfa/verify")
      .send({
        code: totpFromSecret(setup.body.setupKey).generate({
          timestamp: f.now(),
        }),
      })
      .expect(200);
  }
  return setup.body;
}
async function login(f, rememberMe = false) {
  const first = await f.agent
    .post("/api/login")
    .send({
      email: credentials.email,
      password: credentials.password,
      rememberMe,
    })
    .expect(200);
  assert.equal(first.body.mfaRequired, true);
  await f.agent.get("/api/me").expect(401);
  await f.agent.post("/api/token").send({}).expect(401);
  const challenge = await f.agent
    .post("/api/login/challenge")
    .send({ method: "email" })
    .expect(200);
  return f.agent
    .post("/api/verify-login-otp")
    .send({ challengeId: challenge.body.challengeId, code: f.latest() })
    .expect(200);
}

test("complete registration, MFA login, session/JWT access and immediate logout revocation", async (t) => {
  const f = await fixture(t);
  await register(f);
  const loggedIn = await login(f);
  const cookie = loggedIn.headers["set-cookie"].find((value) =>
    value.startsWith("secureid_session="),
  );
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Max-Age/);
  const me = await f.agent.get("/api/me").expect(200);
  assert.equal(me.body.user.email, credentials.email);
  assert.equal(me.body.user.mfaEnabled, true);
  assert.equal(me.body.user.password_hash, undefined);
  await f.agent.post("/api/token").send({}).expect(403);
  const token = await f.agent
    .post("/api/token")
    .set("X-CSRF-Token", me.body.csrfToken)
    .send({})
    .expect(200);
  await request(f.app)
    .get("/api/protected")
    .set("Authorization", `Bearer ${token.body.accessToken}`)
    .expect(200);
  await f.agent.get("/api/protected").expect(401);
  await f.agent
    .post("/api/logout")
    .set("X-CSRF-Token", me.body.csrfToken)
    .send({})
    .expect(200);
  await f.agent.get("/api/me").expect(401);
  await request(f.app)
    .get("/api/protected")
    .set("Authorization", `Bearer ${token.body.accessToken}`)
    .expect(401);
});

test("OTP never returned, hashes stored, attempt counters persist on failure and stage bypass is rejected", async (t) => {
  const f = await fixture(t);
  const registration = await f.agent
    .post("/api/register")
    .send(credentials)
    .expect(200);
  assert.equal(registration.body.otp, undefined);
  assert.equal(registration.body.code, undefined);
  assert.equal(JSON.stringify(registration.body).includes(f.latest()), false);
  const challenge = await f.store.transaction((db) =>
    db.get("SELECT * FROM challenges WHERE id=$1", [
      registration.body.challengeId,
    ]),
  );
  assert.equal(challenge.otp_hash.length, 64);
  assert.notEqual(challenge.otp_hash, f.latest());
  const user = await f.store.transaction((db) =>
    db.get("SELECT * FROM users WHERE email=$1", [credentials.email]),
  );
  assert.match(user.password_hash, /^scrypt:/);
  assert.notEqual(user.password_hash, credentials.password);
  await f.agent.post("/api/send-sms-otp").send({}).expect(403);
  await f.agent.post("/api/mfa/setup").send({ method: "email" }).expect(401);
  const wrong = f.latest() === "000000" ? "111111" : "000000";
  for (let i = 0; i < 3; i++) {
    const result = await f.agent
      .post("/api/verify-email-otp")
      .send({ challengeId: registration.body.challengeId, code: wrong })
      .expect(i === 2 ? 429 : 400);
    assert.equal(result.body.attemptsLeft, 2 - i);
  }
  await f.agent
    .post("/api/verify-email-otp")
    .send({ challengeId: registration.body.challengeId, code: f.latest() })
    .expect(429);
  const stored = await f.store.transaction((db) =>
    db.get("SELECT * FROM challenges WHERE id=$1", [
      registration.body.challengeId,
    ]),
  );
  assert.equal(stored.attempts, 3);
});

test("expiry, resend cooldown, invalidation, and cross-browser challenge binding", async (t) => {
  const f = await fixture(t);
  const initial = await f.agent
    .post("/api/register")
    .send(credentials)
    .expect(200);
  const originalCode = f.latest();
  await request(f.app)
    .post("/api/verify-email-otp")
    .send({ challengeId: initial.body.challengeId, code: originalCode })
    .expect(401);
  await f.agent.post("/api/send-email-otp").send({}).expect(429);
  f.tick(181_000);
  const expired = await f.agent
    .post("/api/verify-email-otp")
    .send({ challengeId: initial.body.challengeId, code: originalCode })
    .expect(410);
  assert.equal(expired.body.code, "OTP_EXPIRED");
  const resend = await f.agent.post("/api/send-email-otp").send({}).expect(200);
  assert.notEqual(resend.body.challengeId, initial.body.challengeId);
  await f.agent
    .post("/api/verify-email-otp")
    .send({ challengeId: initial.body.challengeId, code: originalCode })
    .expect(400);
  const verified = await f.agent
    .post("/api/verify-email-otp")
    .send({ challengeId: resend.body.challengeId, code: f.latest() })
    .expect(200);
  assert.equal(verified.body.next, "sms");
});

test("concurrent valid OTP verification creates only one transition", async (t) => {
  const f = await fixture(t);
  const initial = await f.agent
    .post("/api/register")
    .send(credentials)
    .expect(200);
  const payload = { challengeId: initial.body.challengeId, code: f.latest() };
  const results = await Promise.all([
    f.agent.post("/api/verify-email-otp").send(payload),
    f.agent.post("/api/verify-email-otp").send(payload),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 403]);
  assert.equal(
    f.messages.filter((message) => message.channel === "sms").length,
    1,
  );
});

test("temporary login lockout and resuming unfinished registration", async (t) => {
  const f = await fixture(t);
  await f.agent.post("/api/register").send(credentials).expect(200);
  for (let i = 0; i < 5; i++)
    await f.agent
      .post("/api/login")
      .send({ email: credentials.email, password: "WrongPass!" })
      .expect(i === 4 ? 423 : 401);
  await f.agent.post("/api/login").send(credentials).expect(423);
  f.tick(16 * 60_000);
  const resumed = await f.agent
    .post("/api/login")
    .send(credentials)
    .expect(200);
  assert.equal(resumed.body.registrationRequired, true);
  assert.equal(resumed.body.next, "email");
});

test("authenticator enrollment uses encrypted secrets; TOTP replay rejected", async (t) => {
  const f = await fixture(t);
  const setup = await register(f, "authenticator");
  assert.match(setup.qr, /^data:image\/png;base64,/);
  const stored = await f.store.transaction((db) =>
    db.get("SELECT * FROM users WHERE email=$1", [credentials.email]),
  );
  assert.notEqual(stored.totp_secret, setup.setupKey);
  await f.agent.post("/api/login").send(credentials).expect(200);
  await f.agent
    .post("/api/login/challenge")
    .send({ method: "authenticator" })
    .expect(200);
  const replay = await f.agent
    .post("/api/verify-login-otp")
    .send({
      code: totpFromSecret(setup.setupKey).generate({ timestamp: f.now() }),
    })
    .expect(400);
  assert.equal(replay.body.code, "WRONG_OTP");
  f.tick(31_000);
  await f.agent
    .post("/api/verify-login-otp")
    .send({
      code: totpFromSecret(setup.setupKey).generate({ timestamp: f.now() }),
    })
    .expect(200);
});

test("remember-me persistence, JWT expiration and incorrect JWT audience/signature", async (t) => {
  const f = await fixture(t);
  await register(f);
  const loggedIn = await login(f, true);
  assert.match(
    loggedIn.headers["set-cookie"].find((value) =>
      value.startsWith("secureid_session="),
    ),
    /Max-Age=2592000/,
  );
  const token = await f.agent
    .post("/api/token")
    .set("X-CSRF-Token", loggedIn.body.csrfToken)
    .send({})
    .expect(200);
  const badToken = await new SignJWT({ sid: "test" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test")
    .setAudience("wrong")
    .setIssuer("secureid")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(jwtSecret));
  await f.agent
    .get("/api/protected")
    .set("Authorization", `Bearer ${badToken}`)
    .expect(401);
  await f.agent
    .get("/api/protected")
    .set("Authorization", `Bearer ${token.body.accessToken.slice(0, -6)}abcdef`)
    .expect(401);
  f.tick(301_000);
  await f.agent
    .get("/api/protected")
    .set("Authorization", `Bearer ${token.body.accessToken}`)
    .expect(401);
  await f.agent.get("/api/me").expect(200);
});

test("CSRF/origin protections and malformed request validation", async (t) => {
  const f = await fixture(t);
  await f.agent
    .post("/api/register")
    .set("Origin", "https://attacker.example")
    .send(credentials)
    .expect(403);
  await f.agent
    .post("/api/register")
    .set("Sec-Fetch-Site", "cross-site")
    .send(credentials)
    .expect(403);
  await f.agent
    .post("/api/register")
    .type("form")
    .send(credentials)
    .expect(415);
  await f.agent
    .post("/api/register")
    .set("Content-Type", "application/json")
    .send("{bad")
    .expect(400);
  await f.agent
    .post("/api/register")
    .send({ ...credentials, password: "weak" })
    .expect(400);
  await f.agent
    .post("/api/register")
    .send({ ...credentials, termsAccepted: false })
    .expect(400);
  await register(f);
  const loggedIn = await login(f);
  await f.agent.post("/api/logout").send({}).expect(403);
  await f.agent.get("/api/me").expect(200);
  await f.agent
    .post("/api/logout")
    .set("X-CSRF-Token", loggedIn.body.csrfToken)
    .send({})
    .expect(200);
});

test("password reset invalidates sessions, JWTs, and all pending flows", async (t) => {
  const f = await fixture(t);
  await register(f);
  const loggedIn = await login(f);
  const token = await f.agent
    .post("/api/token")
    .set("X-CSRF-Token", loggedIn.body.csrfToken)
    .send({})
    .expect(200);
  const reset = await f.agent
    .post("/api/password/forgot")
    .send({ email: credentials.email })
    .expect(200);
  await f.agent
    .post("/api/password/reset")
    .send({
      challengeId: reset.body.challengeId,
      code: f.latest(),
      password: "NewTesting!123",
    })
    .expect(200);
  await f.agent.get("/api/me").expect(401);
  await f.agent
    .get("/api/protected")
    .set("Authorization", `Bearer ${token.body.accessToken}`)
    .expect(401);
  await f.agent.post("/api/login").send(credentials).expect(401);
  await f.agent
    .post("/api/login")
    .send({ email: credentials.email, password: "NewTesting!123" })
    .expect(200);
  const anonymous = await request(f.app)
    .post("/api/password/forgot")
    .send({ email: "absent@example.com" })
    .expect(200);
  assert.equal(anonymous.body.message, reset.body.message);
});

test("production fails closed without durable storage and strong distinct secrets", async () => {
  await assert.rejects(
    () =>
      createApp({
        production: true,
        databaseUrl: "",
        secret: "",
        jwtSecret: "",
      }),
    /Production requires/,
  );
});
