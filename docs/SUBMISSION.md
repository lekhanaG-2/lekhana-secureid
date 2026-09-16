# Assignment submission checklist

## Source instructions

- [Assignment document](https://docs.google.com/document/d/1kj9FjWk-JxO5pIIfBZeDinJF69NMpoLB4clPBSneDuo/edit)
- [UI reference boards](https://drive.google.com/drive/folders/19N1xWQJPfw4vSS_D2p_34nV2G0rOmbUx)
- [Implementation guidelines](https://drive.google.com/file/d/1XVRqQB4ccf6badqgrG0D_QWSKXsppYkL/view)
- [IAM training videos](https://drive.google.com/drive/folders/1zjDajiBUfMPEhWLm3pRX7klsbc4M6hj6)

**Deadline discrepancy:** the message says 1 October; the linked document says 27 September. Treat 27 September as the safer deadline unless the recruiter confirms otherwise.

## Required order

1. Personally watch all three IAM videos: `OAuth2.mp4`, `OIDC.mp4`, and `SAML2_IDP_SSO.mp4`. Do not claim completion until you have watched them.
2. Publish the registration journey to the required Vercel domain and verify it from a clean browser session.
3. Send the recruiter the Part 1 completion message and Vercel link on Internshala.
4. Publish the login journey at that same domain. This source includes both journeys; retain the same project and domain when updating it.
5. Share the GitHub repository link on Internshala. Confirm the video-watching requirement only if true.
6. Wait for the Internshala admin's confirmation before starting the later recording exercise.

## Later exercise — candidate must perform this personally

The document asks for a **15–30 minute recording with live coding without AI**. The candidate must create that recording; an AI-generated recording or statement that it was completed would not meet the requirement.

After approval:

- Implement the requested password-strength enhancement live, including Weak / Medium / Strong visual states, dynamic calculation, and enforcing the chosen minimum strength. The initial app already includes the reference's visibility toggle and basic password rules; explain that distinction honestly.
- Explain the full OTP request/response path in the actual submitted code.
- Explain session and JWT creation, storage, transmission, validation, `/api/me`, and logout invalidation.
- Upload your recording to YouTube as unlisted and send its link.

Use `ARCHITECTURE.md` and the code to study beforehand. Do not read a claim that you wrote or recorded work without AI when you did not.

## Message drafts — fill in only verified links

**Part 1**

> Hi, I have completed the registration journey, including email and mobile OTP verification and MFA setup. Vercel link: [actual deployed URL].

**Part 2**

> Hi, I have added the login journey to the same Vercel link, including MFA, session authentication, and a separate JWT-protected API flow. Website: [actual deployed URL]. Source: [actual GitHub repository URL].

Add “I have watched all three IAM Basics videos” only after personally completing them. Ask the recruiter for confirmation before proceeding with the live-coding recording.

## Release verification

- `npm run check` and `npm test` pass.
- Registration and login render on mobile and desktop.
- OTPs are read from backend runtime logs; API responses never contain them.
- `/api/me` rejects an unauthenticated browser.
- OTP attempts, expiry, resends, MFA and account lockout are enforced by the server.
- Authenticated profile access works after login + MFA.
- JWT-protected access works, then fails after logout.
- Production uses Postgres and distinct strong secrets.
- Optional Google OAuth is either configured and tested or clearly identified as unconfigured.
- Do not report a Vercel deployment, GitHub push, recruiter message, video viewing, or recording as completed unless it actually happened.
