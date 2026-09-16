# Authentication walkthrough

## Registration → OTP → MFA

`public/app.js` collects the registration form and sends JSON to `POST /api/register`. Client validation improves feedback, but the server validates every field independently.

The backend hashes the password with Node's `scrypt` using a unique random salt. It inserts a user and starts a short-lived registration flow. A random flow token is placed in an HttpOnly cookie; only its SHA-256 digest is stored in `flows`. Knowing a `challengeId` alone is insufficient to use a challenge in another browser.

`issue()` uses cryptographically secure `randomInt` to generate a six-digit OTP, then stores an HMAC-SHA256 representation bound to the random challenge ID. The HMAC uses a server secret, preventing easy offline enumeration of the one-million-code space from a database dump alone. The code is sent to the simulation delivery function, which prints it to the server terminal. The browser receives the challenge ID and timing metadata, never the code.

`verifyChallenge()` checks the cookie-bound flow, allowed stage/channel, single-use state, expiry, attempt count, and code. Wrong-code results commit their attempt counters before the API returns an error. After three incorrect codes that challenge is blocked. Resends have a 30-second cooldown; challenges expire after three minutes. Flow and account budgets limit attempts and sends across resends.

Email verification changes the backend stage to SMS and issues the SMS challenge. SMS verification marks both required factors complete and enables MFA. The setup screen selects a preferred factor or enrolls an authenticator. Authenticator setup creates an `otpauth://` QR code; the secret is AES-256-GCM encrypted in storage. Enrollment requires a valid TOTP before activating that secret. The backend tracks the last accepted TOTP time step to prevent replay.

All relevant mutations run in a database transaction. SQLite uses `BEGIN IMMEDIATE`; Postgres uses a transaction-scoped advisory lock. This deliberately simple serialization protects this small assignment from simultaneous OTP use and lost attempt-counter updates. A high-throughput production service should replace the global Postgres lock with narrower per-user/per-flow locks while preserving these invariants.

## Password → MFA → session

`POST /api/login` compares the password with its stored scrypt hash. Invalid credentials return a generic message. Five failures temporarily lock the account for 15 minutes. Login also has a rate limit. An unfinished registration can resume after valid credentials.

Valid credentials start a pre-authentication login flow. They do **not** create an authenticated session. The user selects email, SMS, or an already enrolled authenticator. `POST /api/verify-login-otp` performs verification on the server. Only then does `authenticate()` create a session.

The browser receives a random, opaque session identifier in an HttpOnly, SameSite=Lax cookie. On HTTPS production it also uses `Secure` and the `__Host-` prefix. The server stores only the session identifier's digest, associated user, expiry, and a random CSRF token. Normal sessions have an eight-hour server expiry and a browser-session cookie. Remember-me uses a 30-day server expiry and persistent cookie.

`GET /api/me` hashes the supplied cookie token, looks up an unexpired session, and returns only the public user fields and CSRF token. It never returns password hashes or authenticator secrets. The frontend keeps the CSRF token in memory and sends it in `X-CSRF-Token` on session-changing actions. State-changing requests also require JSON and reject cross-site or mismatched Origin requests.

## Separate JWT-protected flow

1. The authenticated frontend calls `POST /api/token` with its session cookie and CSRF header.
2. The backend issues an HS256-signed JWT valid for at most five minutes, never beyond the session's expiry.
3. Claims include `sub` (user), `sid` (backing session digest), `iss`, `aud`, `iat`, `exp`, `jti`, and scope.
4. The browser keeps the token in a JavaScript variable only. It sends it to `GET /api/protected` in the Bearer authorization header and clears that variable after the demonstration call.
5. `jwtVerify()` fixes the allowed algorithm, issuer, and audience; verifies the signature and expiry; and requires the essential claims.
6. The server also checks that the referenced session still exists for the same user. This intentionally makes JWT revocation immediate when the session ends.

No authentication token is stored in `localStorage` or `sessionStorage`.

## Logout and password reset

`POST /api/logout` checks the CSRF token, deletes the server-side session, removes any current pre-authentication flow, and clears both cookies. A copied JWT from that session is immediately rejected by `/api/protected`.

Password reset uses a separate email OTP flow. A successful reset hashes the new password and invalidates **all** sessions and pending flows for that user. It does not disable MFA. The reset-request response avoids saying whether the email has an account.

## Operational boundaries

- The server logs plaintext OTPs only because delivery is explicitly simulated for this assignment. Restrict runtime-log access and use test contact details.
- Optional Google sign-in requires OAuth credentials. It uses state, PKCE, a short-lived encrypted cookie, a server-side code exchange and verified Google email; SecureID MFA remains mandatory.
- Production requires persistent Postgres and stable secrets. Rotating the encryption secret without migrating encrypted TOTP secrets makes those enrollments unreadable.
- This is an assignment implementation, not a certified identity provider. Real deployment at scale would need operational monitoring, recovery policies, email/SMS providers, retention cleanup, and a broader security review.
