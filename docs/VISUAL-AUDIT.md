# Visual audit — 17 September 2026

## Scope and method

Inspected the two registration/login reference image boards extracted from the supplied assignment document. Reviewed 18 distinct UI states in the browser at mobile (390 × 880) and desktop (800 × 800) viewports, using the application's actual rendering functions and stylesheet with deterministic sample data. The boards contain 30 individual reference panels; desktop counterparts for the remaining states are consistency checks rather than exact supplied targets.

The local review fixture is separate from production. It uses sample OTPs, a test enrollment QR, and frozen timers. Its screenshots verify presentation, not live delivery or authentication. Automated authentication tests cover those flows separately.

## States inspected

- Registration details; email OTP, wrong email OTP, expired email OTP.
- SMS OTP, wrong SMS OTP, maximum attempts.
- MFA selection, QR enrollment, authenticator OTP, wrong authenticator OTP, registration success.
- Login, invalid credentials, method selection, email OTP, wrong OTP, expired OTP.

## Corrections

- Compact mobile authenticator and maximum-attempt screens; matching warning treatment.
- Registration error card spacing so error messages do not enlarge the reference email card.
- Mobile verification progress remains on verification step 2.
- Mobile login icon, title, fields, method cards, and OTP spacing.
- Registration help links stay aligned across normal/error states.
- QR and success icon sizing; desktop panel widths follow their respective reference panels.
- Removed unintended one-pixel mobile OTP scrolling.

## Verification

- `npm run check`: passed.
- `npm test`: all 10 tests passed, including registration, OTP expiry/resend/attempt limits, MFA, sessions/JWT, lockout, reset and CSRF protections.
- Browser measurements confirmed no horizontal or vertical overflow at 390 × 880 for the six login states and the first six registration states.
- Desktop login states retain the 696px reference card height.

## Remaining limitations — no pixel-identical certification

The reference consists of scaled composite raster boards, not original screen exports with declared viewport sizes, font files, or vector icons. Typography, antialiasing, and recreated icon paths are not verified pixel-identical. QR patterns, names, OTP digits and timers depend on runtime data. Phone frames, status bars, and native keyboards belong to the device rather than the web page.

The mobile QR reference omits a forward control. The implemented screen keeps explicit Back/Continue controls so a user can proceed to authenticator verification. This is a known visible difference. The desktop reference includes these controls.

Conclusion: all provided screen states have been visually reviewed and concrete mismatches corrected; do not describe the result as an exact pixel-for-pixel reproduction.
