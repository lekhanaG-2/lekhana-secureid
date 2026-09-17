"use strict";

const root = document.querySelector("#app");
const state = {
  screen: "register",
  journey: "registration",
  user: null,
  method: "email",
  selectedMethod: "authenticator",
  challengeId: "",
  expiresAt: 0,
  resendAt: 0,
  error: "",
  errorCode: "",
  attemptsLeft: null,
  csrf: "",
  busy: false,
  setupKey: "",
  qr: "",
  availableMethods: ["email", "sms"],
  notice: "",
};
let timer,
  accessToken = "",
  lastSubmittedCode = "";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const icon = (name, className = "") => {
  const paths = {
    mail: '<rect x="3" y="5" width="26" height="21" rx="1.5"/><path d="m4 7 12 10L28 7"/>',
    phone:
      '<path d="M10 3 5 6c-4 5 10 23 17 22l5-4c1-1-4-7-6-6l-3 2c-3-2-5-4-7-8l2-3c1-2-2-7-3-6Z"/>',
    sms: '<rect x="5" y="6" width="22" height="17" rx="4"/><path d="m8 23-2 5 8-5"/><circle cx="11" cy="14" r=".7"/><circle cx="16" cy="14" r=".7"/><circle cx="21" cy="14" r=".7"/>',
    eye: '<path d="M2 16s5-8 14-8 14 8 14 8-5 8-14 8S2 16 2 16Z"/><circle cx="16" cy="16" r="4"/>',
    eyeoff:
      '<path d="m4 4 24 24M12 8a18 18 0 0 1 18 8l-5 5M8 10l-6 6s5 8 14 8l5-1M13 13a4 4 0 0 0 6 6"/>',
    user: '<circle cx="16" cy="9" r="5"/><path d="M7 28v-5a9 9 0 0 1 18 0v5ZM10 22h12"/>',
    key: '<path d="M4 10h23M4 16h23M4 16v5M10 16v4M16 16v3"/>',
    check: '<path d="m7 16 6 6L26 9"/>',
    back: '<path d="M27 16H5m9-9-9 9 9 9"/>',
    lock: '<rect x="8" y="13" width="16" height="16" rx="2"/><path d="M11 13V9a5 5 0 0 1 10 0v4M16 19v5"/>',
    warning:
      '<path d="M16 2 29 7v10c0 7-13 13-13 13S3 24 3 17V7Z"/><path d="M16 9v9m0 5v1"/>',
  };
  return `<svg class="${className}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.lock}</svg>`;
};
const shield = (white = false) =>
  `<svg class="shield-logo" viewBox="0 0 40 46" aria-hidden="true"><path d="M20 1c6 5 11 6 17 7v15c0 12-17 22-17 22S3 35 3 23V8c6-1 11-2 17-7Z" fill="${white ? "#fff" : "#4430ef"}"/><path d="M20 3v39s15-9 15-20V10c-5-1-10-3-15-7" fill="${white ? "#eff1ff" : "#5b4dfa"}"/><rect x="13" y="19" width="14" height="15" rx="2" fill="${white ? "#4f69da" : "#fff"}"/><path d="M15 19v-6a5 5 0 0 1 10 0v6" fill="none" stroke="${white ? "#4f69da" : "#fff"}" stroke-width="2"/><path d="M20 24v5" stroke="${white ? "#fff" : "#4c36f0"}" stroke-width="2"/></svg>`;
const infoShield = () =>
  '<svg class="info-shield" viewBox="0 0 40 46" aria-hidden="true"><path d="M20 1c6 5 11 6 17 7v15c0 12-17 22-17 22S3 35 3 23V8c6-1 11-2 17-7Z" fill="#4430ef"/><path d="M20 3v39s15-9 15-20V10c-5-1-10-3-15-7" fill="#5b4dfa"/><circle cx="20" cy="15" r="2" fill="#fff"/><path d="M20 21v12" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const googleIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.5l2.86-2.87A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59C7.19 7.71 9.4 5.95 12 5.95Z"/></svg>';
const copyright =
  '<footer class="copyright">© 2024 SecureID. All rights reserved.</footer>';
const backButton = (action) =>
  `<button class="mobile-back" type="button" data-action="${action}" aria-label="Go back">${icon("back")}</button>`;
const errorBox = () =>
  `<p class="form-error" id="form-error" role="alert">${escape(state.error)}</p>`;
const noticeBox = () =>
  `<p class="notice" role="status">${escape(state.notice)}</p>`;
const requirements = () =>
  `<div class="requirements"><h2>Password must contain:</h2><ul class="rules">${[
    ["length", "At least 8 characters"],
    ["uppercase", "1 uppercase letter"],
    ["number", "1 number"],
    ["special", "1 special character"],
  ]
    .map(
      ([key, label]) =>
        `<li data-rule="${key}"><span class="rule-icon">${icon("check")}</span>${label}</li>`,
    )
    .join("")}</ul></div>`;
const passwordField = (
  placeholder = "",
  name = "password",
  label = "Password",
  autocomplete = "current-password",
  login = false,
) =>
  `<label class="field"><span class="${login ? "screen-reader-only" : ""}">${label}</span><div class="input-wrap password ${login ? "has-icon" : ""}">${login ? icon("key") : ""}<input name="${name}" id="${name}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" maxlength="128" required aria-describedby="form-error"><button type="button" class="eye" data-action="toggle-password" data-for="${name}" aria-label="Show password" aria-pressed="false">${icon("eye")}</button></div></label>`;

async function api(path, data, options = {}) {
  const response = await fetch(path, {
    method: options.method || (data === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(state.csrf ? { "X-CSRF-Token": state.csrf } : {}),
      ...options.headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response
    .json()
    .catch(() => ({
      error: "The server could not be reached. Please try again.",
    }));
  if (!response.ok) throw Object.assign(new Error(result.error), result);
  return result;
}
function clearError() {
  state.error = "";
  state.errorCode = "";
  state.attemptsLeft = null;
  lastSubmittedCode = "";
}
function applyChallenge(result) {
  for (const key of [
    "challengeId",
    "method",
    "expiresAt",
    "resendAt",
    "user",
    "availableMethods",
  ])
    if (result[key] !== undefined) state[key] = result[key];
}
function navigate(screen, path, { preserve = false } = {}) {
  if (!preserve) clearError();
  state.screen = screen;
  if (path && location.pathname !== path) history.pushState({}, "", path);
  render();
}
function progress(active) {
  return `<nav class="steps" aria-label="Registration progress">${[1, 2, 3, 4, 5].map((step) => `<span class="step ${step === active ? "active" : step < active ? "done" : ""}" ${step === active ? 'aria-current="step"' : ""} aria-label="Step ${step}">${step}</span>`).join("")}</nav>`;
}
function registrationShell(
  content,
  { active = 2, label = "", details = false, success = false } = {},
) {
  return `<section class="shell register-shell ${details ? "details" : ""} ${success ? "success-shell" : ""}"><header class="topbar"><div class="brand">${shield()}<span>SecureID</span></div><span class="screen-label">${label}</span></header>${progress(active)}${success ? "" : backButton(details ? "login" : state.screen === "registration-otp" ? "registration-back" : "setup-back")}${content}${copyright}</section>`;
}
function loginShell(content) {
  return `<section class="shell login-shell"><aside class="sidebar">${shield(true)}<strong>SecureID</strong><p>Secure access to<br>your account</p></aside><div class="login-main">${content}${copyright}</div></section>`;
}
function registerScreen() {
  return registrationShell(
    `<h1>Create your account</h1><p class="subtitle">Let’s get you started</p>${noticeBox()}<form id="register-form"><div class="register-grid"><div><label class="field"><span>Full Name</span><input name="name" autocomplete="name" placeholder="Full name" minlength="2" maxlength="80" required></label><label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="name@example.com" maxlength="254" required></label><label class="field"><span>Mobile Number</span><div class="phone-row"><select name="country" aria-label="Country calling code"><option value="+91">+91</option><option value="+1">+1</option><option value="+44">+44</option><option value="+61">+61</option><option value="+65">+65</option><option value="+971">+971</option></select><input name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="Mobile number" pattern="[0-9 ()-]{7,18}" required></div></label>${passwordField("", "password", "Password", "new-password")}</div><div>${requirements()}<label class="terms"><input type="checkbox" name="terms" required><span>I agree to the <button type="button" class="link" data-action="terms">Terms &amp; Conditions</button><br>and <button type="button" class="link" data-action="privacy">Privacy Policy</button></span></label></div></div>${errorBox()}<button class="primary" type="submit">Create Account</button></form><p class="account-prompt">Already have an account? <a href="/login" data-nav="login">Login</a></p>`,
    { active: 1, details: true },
  );
}
function otpInputs() {
  return `<div class="otp-group" role="group" aria-label="6-digit verification code">${Array.from({ length: 6 }, (_, i) => `<input name="digit${i}" class="otp-digit" aria-label="Digit ${i + 1}" type="text" inputmode="numeric" pattern="[0-9]" maxlength="1" ${i === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'} required aria-describedby="otp-error"${state.errorCode === "MAX_ATTEMPTS" || state.errorCode === "OTP_EXPIRED" ? " disabled" : ""}>`).join("")}</div>`;
}
function timeMarkup() {
  return `<p class="timer">Code expires in <strong id="expires-time">${formatTime(Math.max(0, state.expiresAt - Date.now()))}</strong></p><button type="button" class="link resend" data-action="resend" id="resend-button">Resend code</button>`;
}
const formatTime = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
function otpScreen(login) {
  const email = state.method === "email",
    authenticator = state.method === "authenticator";
  const expired = state.errorCode === "OTP_EXPIRED",
    max = state.errorCode === "MAX_ATTEMPTS";
  const wrong = state.errorCode === "WRONG_OTP";
  const title = authenticator
    ? "Enter the 6-digit code"
    : login
      ? `${email ? "Email" : "SMS"} Verification`
      : `Verify your ${email ? "email" : "mobile"}`;
  const destination = email ? state.user?.email : state.user?.phone;
  const subtitle = authenticator
    ? "Enter the code from your<br>authenticator app"
    : `${login ? "Enter the 6-digit code sent to" : "We have sent a 6-digit code to"}<strong>${escape(destination)}</strong>`;
  const badge = `<div class="icon-circle ${login ? "mobile-login-icon" : ""} ${!login && (wrong || expired || max) ? "red" : !email && !authenticator ? "green" : ""}">${authenticator ? (wrong ? icon("warning") : infoShield()) : icon(email ? "mail" : "phone")}</div>`;
  let message = state.error;
  if (wrong && state.attemptsLeft !== null && !authenticator)
    message += `\nYou have ${state.attemptsLeft} attempt${state.attemptsLeft === 1 ? "" : "s"} left.`;
  const help = authenticator
    ? `<button class="link help" data-action="auth-help">Can’t access your app?</button>`
    : !login && !email
      ? `<p class="help phone-help">Wrong number? <button class="link" data-action="change-phone">Change</button></p>`
      : `<button class="link help" data-action="delivery-help">Didn’t receive the code?</button>`;
  let controls;
  if (authenticator)
    controls = `<p class="timer">Code expires in <strong id="expires-time">${formatTime(state.expiresAt - Date.now())}</strong></p>`;
  else if (expired || max)
    controls = `<button class="primary" data-action="resend" id="resend-button">${login ? "Resend code" : "Resend New Code"}</button>${login ? '<p class="cooldown-note" id="cooldown-note"></p>' : ""}`;
  else controls = timeMarkup();
  const content = `<div class="${login ? "login-content otp-content" : "verify-content registration-otp"} ${expired ? "expired" : ""} ${authenticator ? "authenticator-otp" : ""} ${max ? "max-attempts" : ""} ${wrong ? "wrong-code" : ""}">${login ? backButton("choose") : ""}${badge}<h1>${title}</h1><p class="verify-copy">${subtitle}</p><form id="otp-form" class="otp-form">${otpInputs()}<p id="otp-error" class="otp-message ${!login && !authenticator && (wrong || max) ? "banner" : ""}" role="alert">${escape(message)}</p><button type="submit" class="otp-submit">Verify code</button></form>${controls}${help}</div>`;
  if (login) return loginShell(content);
  const label = authenticator
    ? wrong
      ? "6a. MFA Wrong Code"
      : "6. MFA Verification"
    : email
      ? wrong
        ? "2a. Email OTP - Wrong Code"
        : expired
          ? "2b. Email OTP - Expired"
          : "2. Email Verification - OTP"
      : max
        ? "3b. Mobile OTP - Max Attempts"
        : wrong
          ? "3a. Mobile OTP - Wrong Code"
          : "3. Mobile Verification - OTP";
  return registrationShell(content, {
    active: authenticator ? 4 : 2,
    label,
  });
}
function methodOptions(login) {
  const items = login
    ? [
        ["email", "Email OTP", "Receive a code on your email", "mail"],
        ["sms", "SMS OTP", "Receive a code on your mobile", "sms"],
        [
          "authenticator",
          "Authenticator App",
          "Use code from authenticator app",
          "lock",
        ],
      ]
    : [
        [
          "authenticator",
          "Authenticator App",
          "(Google Authenticator / Authy)",
          "lock",
        ],
        ["sms", "SMS Authentication", "Receive codes on your mobile", "sms"],
        [
          "email",
          "Email Authentication",
          "Receive codes on your email",
          "mail",
        ],
      ];
  return `<div class="methods" role="radiogroup" aria-label="Verification method">${items.map(([method, title, copy, symbol]) => `<label class="method ${method} ${state.selectedMethod === method ? "selected" : ""}"><span class="method-icon">${icon(symbol)}</span><span class="method-copy"><strong>${title}</strong><small>${copy}</small></span><input type="radio" name="method" value="${method}" ${state.selectedMethod === method ? "checked" : ""}></label>`).join("")}</div>`;
}
function setupScreen(login) {
  const content = `<div class="${login ? "login-content choose" : "verify-content setup-content"}">${login ? backButton("login") : ""}<div class="icon-circle shield ${login ? "mobile-login-icon" : ""}">${login ? shield() : infoShield()}</div><h1>${login ? "Verify your identity" : "Set up Multi-Factor Auth"}</h1><p class="verify-copy">${login ? "Choose a method to continue" : "Add an extra layer of security<br>to protect your account."}</p>${methodOptions(login)}${errorBox()}<button class="primary" data-action="continue-method">Continue</button></div>`;
  return login
    ? loginShell(content)
    : registrationShell(content, { active: 4, label: "4. Set Up MFA" });
}
function qrScreen() {
  return registrationShell(
    `<div class="verify-content qr-content"><h1>Scan QR Code</h1><p class="verify-copy">Open your authenticator app and<br>scan this QR code</p><img class="qr" src="${escape(state.qr)}" width="180" height="180" alt="SecureID authenticator enrollment QR code"><button class="link" data-action="setup-key">Can’t scan? Enter setup key</button><p class="setup-key" id="setup-key" hidden>${escape(state.setupKey)}</p>${errorBox()}<div class="actions"><button class="secondary" data-action="setup-back">Back</button><button class="primary" data-action="verify-authenticator">Continue</button></div></div>`,
    { active: 4, label: "5. Authenticator Setup" },
  );
}
function successScreen() {
  return registrationShell(
    `<div class="verify-content success-content"><div class="icon-circle green">${icon("check")}</div><h1>Account created!</h1><p class="verify-copy">Your account has been created<br>successfully and MFA is enabled.</p><ul class="success-list"><li>${icon("check")}Email verified</li><li>${icon("check")}Mobile verified</li><li>${icon("check")}MFA enabled</li></ul><button class="primary" data-action="login">Continue to Login</button></div>`,
    { success: true, label: "7. Registration Success" },
  );
}
function loginScreen() {
  return loginShell(
    `<div class="login-content"><div class="icon-circle mobile-login-icon ${state.error ? "red" : ""}">${shield()}</div><h1>Welcome back!</h1><p class="subtitle">Login to your account</p>${noticeBox()}<form id="login-form" class="login-form"><label class="field"><span class="screen-reader-only">Email or Username</span><div class="input-wrap has-icon">${icon("user")}<input name="email" autocomplete="username" placeholder="Email or Username" maxlength="254" required aria-describedby="form-error"></div></label>${passwordField("Password", "password", "Password", "current-password", true)}${errorBox()}<div class="login-options"><label class="remember"><input type="checkbox" name="remember">Remember me</label><a href="/forgot-password" data-nav="forgot" class="link">Forgot password?</a></div><button class="primary" type="submit">Login</button></form><div class="divider">or</div><button type="button" class="google" data-action="google">${googleIcon}Continue with Google</button><p class="account-prompt">New here? <a href="/register" data-nav="register">Create an account</a></p></div>`,
  );
}
function dashboardScreen() {
  const user = state.user;
  return `<section class="shell dashboard"><header class="dashboard-header"><div class="brand">${shield()}SecureID</div><button class="secondary" data-action="logout">Log out</button></header><div class="icon-circle green">${icon("check")}</div><h1>Welcome, ${escape(user.name)}!</h1><p class="subtitle">You’re securely signed in.</p><dl class="profile"><dt>Email</dt><dd>${escape(user.email)}</dd><dt>Mobile</dt><dd>${escape(user.phone)}</dd><dt>Verification</dt><dd>Email and mobile verified</dd><dt>Multi-factor auth</dt><dd>${escape({ email: "Email OTP", sms: "SMS OTP", authenticator: "Authenticator app" }[user.mfaMethod])}</dd></dl><section class="protected-card"><h2>Protected account access</h2><p>Verify access to your profile using a short-lived access token.</p><button class="primary" data-action="protected">Check protected access</button><div class="protected-result" id="protected-result" role="status"></div></section>${errorBox()}${copyright}</section>`;
}
function forgotScreen(reset = false) {
  return loginShell(
    `<div class="login-content"><div class="icon-circle mobile-login-icon">${shield()}</div><h1>${reset ? "Reset your password" : "Forgot password?"}</h1><p class="subtitle">${reset ? "Enter your email code and a new password." : "Enter your email to receive a reset code."}</p><form class="reset-form" id="${reset ? "reset-form" : "forgot-form"}">${reset ? `${otpInputs()}${passwordField("", "new-password", "New password", "new-password")}${requirements()}` : '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="name@example.com" required></label>'}${errorBox()}<button class="primary" type="submit">${reset ? "Reset password" : "Send reset code"}</button></form><a class="back-login" href="/login" data-nav="login">Back to Login</a></div>`,
  );
}
function render() {
  clearInterval(timer);
  root.removeAttribute("aria-busy");
  const screens = {
    register: registerScreen,
    "registration-otp": () => otpScreen(false),
    setup: () => setupScreen(false),
    qr: qrScreen,
    success: successScreen,
    login: loginScreen,
    choose: () => setupScreen(true),
    "login-otp": () => otpScreen(true),
    dashboard: dashboardScreen,
    forgot: () => forgotScreen(false),
    reset: () => forgotScreen(true),
  };
  root.innerHTML = (screens[state.screen] || loginScreen)();
  document.title = `SecureID — ${root.querySelector("h1")?.textContent || "Secure access"}`;
  bindForms();
  if (["registration-otp", "login-otp"].includes(state.screen)) {
    bindOtp();
    updateTimer();
    timer = setInterval(updateTimer, 1000);
  } else if (state.screen === "reset") bindOtp(false);
}
function displayFormError(error, form) {
  state.error = error.message || "Unable to connect. Please try again.";
  state.errorCode = error.code || "NETWORK_ERROR";
  const box =
    form.querySelector("#form-error") || root.querySelector("#form-error");
  if (box) box.textContent = state.error;
  if (error.code === "INVALID_CREDENTIALS" || error.code === "ACCOUNT_LOCKED") {
    form.querySelectorAll("input:not([type=checkbox])").forEach((input) => {
      input.classList.add("invalid-input");
      input.setAttribute("aria-invalid", "true");
    });
    root.querySelector(".mobile-login-icon")?.classList.add("red");
  }
}
async function runBusy(action, button) {
  if (state.busy) return;
  state.busy = true;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  try {
    return await action();
  } finally {
    state.busy = false;
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}
function bindForms() {
  const register = root.querySelector("#register-form");
  register?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(register);
    if (!passwordValid(data.get("password"))) {
      displayFormError(
        new Error("Your password must meet all four requirements."),
        register,
      );
      return;
    }
    runBusy(async () => {
      try {
        const response = await api("/api/register", {
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("country") + data.get("phone"),
          password: data.get("password"),
          termsAccepted: data.get("terms") === "on",
        });
        applyChallenge(response);
        state.journey = "registration";
        state.notice = "";
        navigate("registration-otp");
      } catch (error) {
        displayFormError(error, register);
      }
    }, register.querySelector("[type=submit]"));
  });
  const login = root.querySelector("#login-form");
  login?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(login);
    runBusy(async () => {
      try {
        const response = await api("/api/login", {
          email: data.get("email"),
          password: data.get("password"),
          rememberMe: data.get("remember") === "on",
        });
        applyChallenge(response);
        state.notice = "";
        if (response.registrationRequired) {
          state.journey = "registration";
          navigate(
            response.next === "setup" ? "setup" : "registration-otp",
            "/register",
          );
        } else {
          state.journey = "login";
          state.selectedMethod = "email";
          navigate("choose");
        }
      } catch (error) {
        displayFormError(error, login);
      }
    }, login.querySelector("[type=submit]"));
  });
  root.querySelector("#forgot-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    runBusy(async () => {
      try {
        const result = await api("/api/password/forgot", {
          email: new FormData(form).get("email"),
        });
        applyChallenge(result);
        navigate("reset");
      } catch (error) {
        displayFormError(error, form);
      }
    }, form.querySelector("[type=submit]"));
  });
  root.querySelector("#reset-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    runBusy(async () => {
      try {
        await api("/api/password/reset", {
          code: getCode(),
          challengeId: state.challengeId,
          password: data.get("new-password"),
        });
        state.notice =
          "Your password has been reset. Log in with your new password.";
        state.csrf = "";
        accessToken = "";
        navigate("login", "/login");
      } catch (error) {
        displayFormError(error, form);
      }
    }, form.querySelector("[type=submit]"));
  });
  root
    .querySelectorAll("input[type=password]")
    .forEach((input) =>
      input.addEventListener("input", () => updateRules(input.value)),
    );
  root.querySelectorAll("input[name=method]").forEach((input) =>
    input.addEventListener("change", () => {
      state.selectedMethod = input.value;
      root
        .querySelectorAll(".method")
        .forEach((label) =>
          label.classList.toggle(
            "selected",
            label.querySelector("input").checked,
          ),
        );
    }),
  );
}
const passwordRules = (value) => ({
  length: value.length >= 8,
  uppercase: /[A-Z]/.test(value),
  number: /[0-9]/.test(value),
  special: /[^A-Za-z0-9\s]/.test(value),
});
const passwordValid = (value) =>
  Object.values(passwordRules(value)).every(Boolean);
function updateRules(value) {
  const rules = passwordRules(value);
  root
    .querySelectorAll("[data-rule]")
    .forEach((item) =>
      item.classList.toggle("valid", rules[item.dataset.rule]),
    );
}
const getCode = () =>
  [...root.querySelectorAll(".otp-digit")].map((input) => input.value).join("");
function bindOtp(autoSubmit = true) {
  const digits = [...root.querySelectorAll(".otp-digit")];
  const submit = () => {
    const code = getCode();
    if (autoSubmit && code.length === 6 && code !== lastSubmittedCode)
      verifyCode(code);
  };
  digits.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      input.classList.remove("invalid-input");
      input.removeAttribute("aria-invalid");
      if (input.value && index < 5) digits[index + 1].focus();
      if (index === 5) submit();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0)
        digits[index - 1].focus();
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        digits[index - 1].focus();
      }
      if (event.key === "ArrowRight" && index < 5) {
        event.preventDefault();
        digits[index + 1].focus();
      }
    });
    input.addEventListener("focus", () => input.select());
    input.addEventListener("paste", (event) => {
      event.preventDefault();
      const code = event.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, 6);
      if (!code) return;
      const start = code.length === 6 ? 0 : index;
      [...code].forEach((digit, i) => {
        if (digits[start + i]) digits[start + i].value = digit;
      });
      digits[Math.min(start + code.length, 5)].focus();
      submit();
    });
  });
  root.querySelector("#otp-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (getCode().length === 6) verifyCode(getCode());
  });
}
async function verifyCode(code) {
  if (state.busy) return;
  lastSubmittedCode = code;
  root.setAttribute("aria-busy", "true");
  await runBusy(async () => {
    try {
      const path =
        state.journey === "login"
          ? "/api/verify-login-otp"
          : state.method === "authenticator"
            ? "/api/mfa/verify"
            : `/api/verify-${state.method}-otp`;
      const result = await api(path, { challengeId: state.challengeId, code });
      if (result.authenticated) {
        state.user = result.user;
        state.csrf = result.csrfToken;
        navigate("dashboard", "/dashboard");
      } else if (result.next === "sms") {
        applyChallenge(result);
        navigate("registration-otp");
      } else if (result.next === "setup") {
        state.selectedMethod = "authenticator";
        navigate("setup");
      } else if (result.next === "success") navigate("success");
    } catch (error) {
      state.error = error.message;
      state.errorCode = error.code;
      state.attemptsLeft = error.attemptsLeft ?? null;
      if (error.code === "FLOW_EXPIRED") {
        state.notice = error.message;
        navigate("login", "/login");
        return;
      }
      render();
      if (!["MAX_ATTEMPTS", "OTP_EXPIRED"].includes(error.code)) {
        const digits = [...root.querySelectorAll(".otp-digit")];
        [...code].forEach((digit, i) => {
          if (digits[i]) digits[i].value = digit;
        });
        digits[5]?.classList.add("invalid-input");
        digits[5]?.setAttribute("aria-invalid", "true");
        digits[5]?.focus();
      }
      lastSubmittedCode = code;
    } finally {
      root.removeAttribute("aria-busy");
    }
  });
}
function updateTimer() {
  if (state.method === "authenticator" && state.expiresAt <= Date.now())
    state.expiresAt = (Math.floor(Date.now() / 30_000) + 1) * 30_000;
  const expires = root.querySelector("#expires-time");
  if (expires) expires.textContent = formatTime(state.expiresAt - Date.now());
  const button = root.querySelector("#resend-button");
  if (button) {
    const remaining = state.resendAt - Date.now();
    button.disabled = remaining > 0 || state.busy;
    if (button.classList.contains("link"))
      button.textContent =
        remaining > 0
          ? `Resend code (${formatTime(remaining)})`
          : "Resend code";
    const note = root.querySelector("#cooldown-note");
    if (note) {
      note.replaceChildren();
      if (remaining > 0) {
        note.append("You can request a new code in ");
        const strong = document.createElement("strong");
        strong.textContent = formatTime(remaining);
        note.append(strong);
      }
    }
  }
  if (
    state.method !== "authenticator" &&
    state.expiresAt &&
    state.expiresAt <= Date.now() &&
    !["OTP_EXPIRED", "MAX_ATTEMPTS", "FLOW_LOCKED"].includes(state.errorCode) &&
    !state.busy
  ) {
    state.errorCode = "OTP_EXPIRED";
    state.error =
      state.journey === "login" ? "Code expired." : "This code has expired.";
    render();
  }
}
function showDialog(title, message) {
  const dialog = document.querySelector("#help-dialog"),
    content = document.querySelector("#dialog-content");
  content.replaceChildren();
  const heading = document.createElement("h2");
  heading.id = "dialog-title";
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  content.append(heading, paragraph);
  dialog.showModal();
}
document
  .querySelector("#dialog-close")
  .addEventListener("click", () =>
    document.querySelector("#help-dialog").close(),
  );
document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    event.preventDefault();
    state.notice = "";
    navigate(nav.dataset.nav, nav.getAttribute("href"));
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "toggle-password") {
    const input = document.getElementById(button.dataset.for),
      showing = input.type === "password";
    input.type = showing ? "text" : "password";
    button.setAttribute(
      "aria-label",
      showing ? "Hide password" : "Show password",
    );
    button.setAttribute("aria-pressed", String(showing));
    button.innerHTML = icon(showing ? "eyeoff" : "eye");
    return;
  }
  if (action === "login") {
    state.notice = "";
    navigate("login", "/login");
    return;
  }
  if (action === "registration-back") {
    state.notice = "Log in with your new credentials to resume verification.";
    navigate("login", "/login");
    return;
  }
  if (action === "setup-back") {
    state.selectedMethod = "authenticator";
    navigate("setup");
    return;
  }
  if (action === "choose") {
    navigate("choose");
    return;
  }
  if (action === "setup-key") {
    document.querySelector("#setup-key").hidden =
      !document.querySelector("#setup-key").hidden;
    return;
  }
  if (action === "verify-authenticator") {
    state.method = "authenticator";
    state.expiresAt = (Math.floor(Date.now() / 30_000) + 1) * 30_000;
    navigate("registration-otp");
    return;
  }
  if (action === "terms") {
    showDialog(
      "Terms & Conditions",
      "SecureID is an assignment demonstration. Use only test details. Verification delivery is simulated. Account access requires password authentication and multi-factor verification.",
    );
    return;
  }
  if (action === "privacy") {
    showDialog(
      "Privacy Policy",
      "This demonstration stores your account details, a salted password hash, verification challenges, and authentication sessions. Simulated email and SMS codes are written to restricted server logs. Use test details; do not enter a password used on another service.",
    );
    return;
  }
  if (action === "delivery-help") {
    showDialog(
      "Receiving your verification code",
      "For this assignment, email and SMS delivery are simulated. The code is printed in the local server terminal or the project’s Vercel runtime logs. Ask the project owner for the latest code. It expires after 3 minutes. You can request another code after 30 seconds.",
    );
    return;
  }
  if (action === "auth-help") {
    if (state.journey === "login") navigate("choose");
    else {
      showDialog(
        "Authenticator setup",
        "Use the current 6-digit code in your authenticator app. If you cannot access it, go back and choose Email Authentication or SMS Authentication.",
      );
    }
    return;
  }
  if (action === "google") {
    try {
      const config = await api("/api/config");
      if (config.googleEnabled) location.assign("/api/auth/google");
      else
        showDialog(
          "Google sign-in",
          "Google sign-in has not been connected for this deployment. Use your email and password to continue.",
        );
    } catch (error) {
      showDialog("Unable to connect", error.message);
    }
    return;
  }
  if (action === "change-phone") {
    const dialog = document.querySelector("#help-dialog"),
      content = document.querySelector("#dialog-content");
    content.innerHTML =
      '<h2 id="dialog-title">Change mobile number</h2><form id="phone-form"><label class="field"><span>Mobile number with country code</span><input name="phone" type="tel" autocomplete="tel" placeholder="+91 98765 43210" required></label><p class="form-error" id="phone-error" role="alert"></p><button class="primary" type="submit">Send new code</button></form>';
    dialog.showModal();
    content.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      runBusy(async () => {
        try {
          const result = await api("/api/change-phone", {
            phone: new FormData(form).get("phone"),
          });
          applyChallenge(result);
          clearError();
          dialog.close();
          render();
        } catch (error) {
          content.querySelector("#phone-error").textContent = error.message;
        }
      }, form.querySelector("button"));
    });
    return;
  }
  await runBusy(async () => {
    try {
      if (action === "continue-method") {
        const login = state.screen === "choose";
        const result = await api(
          login ? "/api/login/challenge" : "/api/mfa/setup",
          { method: state.selectedMethod },
        );
        if (login) {
          applyChallenge(result);
          state.journey = "login";
          navigate("login-otp");
        } else if (result.next === "qr") {
          state.qr = result.qr;
          state.setupKey = result.setupKey;
          navigate("qr");
        } else navigate("success");
      } else if (action === "resend") {
        const result = await api(
          state.journey === "login"
            ? "/api/login/challenge"
            : `/api/send-${state.method}-otp`,
          state.journey === "login"
            ? { method: state.method, resend: true }
            : {},
        );
        applyChallenge(result);
        clearError();
        render();
        root.querySelector(".otp-digit")?.focus();
      } else if (action === "logout") {
        await api("/api/logout", {});
        accessToken = "";
        state.csrf = "";
        state.user = null;
        navigate("login", "/login");
      } else if (action === "protected") {
        const result = await api("/api/token", {});
        accessToken = result.accessToken;
        const verified = await api("/api/protected", undefined, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        document.querySelector("#protected-result").textContent =
          `${verified.message}\nSigned in as ${verified.user.email}.`;
        accessToken = "";
      }
    } catch (error) {
      if (error.code === "UNAUTHENTICATED" || error.code === "FLOW_EXPIRED") {
        state.notice = error.message;
        navigate("login", "/login");
        return;
      }
      state.error = error.message;
      state.errorCode = error.code || "NETWORK_ERROR";
      if (error.retryAfter)
        state.resendAt = Date.now() + error.retryAfter * 1000;
      const box =
        root.querySelector("#form-error") || root.querySelector("#otp-error");
      if (box) box.textContent = error.message;
      else showDialog("Please try again", error.message);
    }
  }, button);
});
window.addEventListener("popstate", () => {
  state.notice = "";
  navigate(
    location.pathname === "/register" || location.pathname === "/"
      ? "register"
      : location.pathname === "/forgot-password"
        ? "forgot"
        : "login",
  );
});
async function initialize() {
  root.innerHTML =
    '<div class="loading"><div class="spinner" aria-hidden="true"></div>Loading SecureID…</div>';
  const params = new URLSearchParams(location.search);
  state.notice =
    {
      "google-unavailable":
        "Google sign-in is not configured. Please use email and password.",
      "google-failed":
        "Google sign-in could not be completed. Please try again.",
      "register-first":
        "Create and verify a SecureID account first, then use Google to sign in.",
    }[params.get("notice")] || "";
  try {
    const session = await api("/api/me");
    state.user = session.user;
    state.csrf = session.csrfToken;
    navigate("dashboard", "/dashboard");
    return;
  } catch (error) {
    if (error.code !== "UNAUTHENTICATED") state.notice = error.message;
  }
  if (
    params.get("resume") === "1" ||
    location.pathname === "/register" ||
    location.pathname === "/"
  ) {
    try {
      const journey = await api("/api/journey");
      if (journey.purpose === "registration" || params.get("resume") === "1") {
        applyChallenge(journey);
        state.journey = journey.purpose;
        state.selectedMethod =
          journey.purpose === "login" ? "email" : "authenticator";
        if (journey.purpose === "login") navigate("choose", "/login");
        else if (journey.stage === "success") navigate("success", "/register");
        else if (journey.stage === "setup" || journey.stage === "authenticator")
          navigate("setup", "/register");
        else navigate("registration-otp", "/register");
        return;
      }
    } catch {
      /* No resumable journey; show the requested entry screen. */
    }
  }
  navigate(
    location.pathname === "/login" || location.pathname === "/dashboard"
      ? "login"
      : location.pathname === "/forgot-password"
        ? "forgot"
        : "register",
  );
}
initialize();
