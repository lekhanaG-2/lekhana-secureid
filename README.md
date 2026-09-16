# SecureID

Registration and login journeys implemented with **HTML, CSS, vanilla JavaScript, Node.js, and Express**, following the supplied SecureID reference boards.

## Run locally

Use Node.js 22.13 or newer (Node 22 LTS recommended).

```sh
npm ci
npm start
```

Open `http://localhost:3000`. If that port is occupied, set `PORT` and `APP_ORIGIN` together in a `.env` file copied from `.env.example`.

```dotenv
PORT=4317
APP_ORIGIN=http://localhost:4317
```

Local accounts are stored in `data/secureid.sqlite`. Development secrets are generated once in `data/development-secrets.json`. Both are ignored by Git. The local preview must stay running to be accessible.

## Try both journeys

1. Open `/register`, enter test details, meet the four password requirements, and accept the demonstration terms.
2. Read the simulated email OTP from the **server terminal**. Enter it in the six boxes. Pasting a full six-digit code is supported.
3. Read the next simulated SMS OTP from the terminal and verify it.
4. Choose email, SMS, or an authenticator app as your preferred MFA method. Authenticator enrollment generates a real QR code and requires a valid app code.
5. Continue to `/login`. Enter the same email and password, choose a factor, and complete verification.
6. The authenticated page calls `/api/me`. **Check protected access** obtains a short-lived JWT and sends it to `/api/protected` using `Authorization: Bearer ...`.
7. Log out. The session is removed server-side and JWTs tied to it immediately stop working.

**Delivery is simulated, exactly as permitted by the assignment.** No real email or SMS is sent. OTPs never appear in API responses, browser storage, or the UI. On Vercel, the project owner reads the OTP from restricted runtime logs. A reviewer needs the owner available to supply the latest code, or access to those logs. This is not a public SMS/email delivery service.

The “Email or Username” field accepts the registered email because the registration reference does not define a separate username field.

## Test

```sh
npm run check
npm test
```

The test suite exercises registration, email/SMS verification, OTP expiry, cooldowns, attempt limits, concurrent verification, cross-browser binding, registration resumption, lockout, authenticator enrollment/replay prevention, cookies, CSRF, JWT validation/expiry/revocation, and password reset.

## Deploy to Vercel

1. Push this directory as the root of a GitHub repository.
2. Import the repository into Vercel with the **Express** framework preset and Node.js **22.x**.
3. Name the project `lekhana-secureid` if that name is available. The required address is `https://lekhana-secureid.vercel.app`.
4. Connect a persistent Postgres database (for example Neon through the Vercel Marketplace). Set its pooled connection string as `DATABASE_URL`.
5. Generate **two different** random secrets. Run the following separately for each:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

6. Set these environment variables in Vercel:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Persistent Postgres connection string |
   | `APP_SECRET` | First random secret, at least 32 characters |
   | `JWT_SECRET` | Different random secret, at least 32 characters |
   | `APP_ORIGIN` | Exact deployed HTTPS origin, without a trailing slash |

7. Deploy and test both journeys at the **production domain**. The configured origin is checked for state-changing requests. Preview deployments should use their own matching origin and an isolated database.

Tables are initialized from `server/schema.sql`. The application deliberately returns a configuration error on Vercel if the database or secrets are missing; it does not silently store production users in memory or in an ephemeral file.

### Optional Google sign-in

The reference includes “Continue with Google.” The authorization-code flow is implemented, but requires your own Google OAuth client:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- Authorized redirect URI: `https://lekhana-secureid.vercel.app/api/auth/google/callback`

Without credentials the button explains that Google is not connected. Google sign-in supports existing, fully verified SecureID accounts and **still requires SecureID MFA**. It does not create incomplete accounts or bypass phone verification.

## Structure

```text
public/index.html       Document shell
public/styles.css       Responsive reference-based styling
public/app.js           Forms, screen transitions, OTP input and API calls
server.js               Express entry point, local listener and Vercel export
server/app.js           Authentication routes and security decisions
server/security.js      Password hashing, OTP protection, encrypted TOTP secrets
server/store.js         SQLite for local use, Postgres for production
server/schema.sql       User, flow, challenge, session and rate-limit tables
test/auth.test.js       Integration and security tests
docs/ARCHITECTURE.md    Request and authentication walkthrough
docs/SUBMISSION.md      Required submission order and personal tasks
```

## Reference scope

- The registration and login boards define separate mobile and desktop layouts. Phone bezels, screenshot titles, status bars, and operating-system keyboards are not part of the web page. Numeric inputs request the device’s native numeric keyboard.
- Empty forms show placeholders; the reference’s example personal details are not preloaded as real account data.
- Real countdown values, entered details, QR data, validation outcomes, and OTPs change with the server state.
- The initial registration form includes the reference’s password checklist and show/hide control. The later requested Weak/Medium/Strong live-coding enhancement is reserved for the candidate’s recorded exercise after admin approval.
- The authenticated profile page and password-reset screens complete functional paths not illustrated in the supplied boards.
- Backend correctness is tested. Visual resemblance was inspected in a browser; a pixel-identical result has not been established from original design files.

See [submission checklist](docs/SUBMISSION.md) for remaining external and personal requirements.
