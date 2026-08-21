---
target: docs/flujos/onboarding-login-registro.md
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-21T02-44-55Z
slug: docs-flujos-onboarding-login-registro-md
---
Method: dual-agent (A: general-purpose review agent · B: general-purpose detector/evidence agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | No loading/spinner or double-tap guard on submit actions |
| 2 | Match System / Real World | 2 | Copy is functionally correct but never frames the "my pet is missing" urgency |
| 3 | User Control and Freedom | 2 | No guest/browse path; only exit is the login/register text link |
| 4 | Consistency and Standards | 3 | Dark/light toggle silently dropped from the new SMS screen |
| 5 | Error Prevention | 3 | Disabled-until-valid buttons solid; field-level validation timing only specified for Login |
| 6 | Recognition Rather Than Recall | 3 | Masked phone redisplayed, fields preserved on "cambiar número" |
| 7 | Flexibility and Efficiency | 1 | No Android SMS autofill/OTP-retriever mentioned |
| 8 | Aesthetic and Minimalist Design | 2 | 5 fields + 2 checkboxes, no chunking or inline password guidance |
| 9 | Error Recovery | 4 | Strong: asymmetric login/registro error copy, full SMS failure taxonomy |
| 10 | Help and Documentation | 2 | Support link only appears after 2 failed resends |
| **Total** | | **25/40** | **Acceptable (62.5%)** |

## Design Specificity Verdict

**LLM assessment**: Mostly a generic SaaS-signup skeleton wearing PawFound branding. Real tailoring is narrow: Colombian phone format, the SMS-badge mechanic, and the asymmetric error-message reasoning. Nothing before Home acknowledges that the person filling this out may be doing so because their pet just ran off.

**Deterministic scan**: `detect.mjs` returned exit 0 / `[]` — expected and uninformative, since it scans markup and this target is prose. In its place, Assessment B cross-checked every concrete UI claim against `login.png` and `Registro.png` directly and found the spec's own facts accurate (fields, button labels, checkbox default on Términos, the provider mismatch already flagged) except two gaps: **"Recordar sesión" is pre-checked in the mockup but the spec never states its default**, and the spec describes the "toggle" of light/dark mode as one control when the mockups show **two separate icon buttons** (sun / moon), which conflicts with the doc's own accessibility note calling for one `switch` role.

## Overall Impression

The document's error-handling and security reasoning (SMS retry/lockout taxonomy, login-vs-registro message asymmetry) is genuinely above-average craft for a first-pass spec. What's missing is everything upstream and downstream of the form fields: no entry point that doesn't force signup first, an undefined relationship between social login and the SMS-verification/badge mechanic that's supposed to be the product's core trust signal, and zero acknowledgment of the emotional state of the person filling it out.

## What's Working

1. The login/registro error-message asymmetry (generic on login to prevent enumeration, explicit on registro to help people find their account) is real security/UX tradeoff thinking, not boilerplate.
2. The SMS verification edge cases (wrong code, 5-attempt lockout, expiry, resend, support fallback) are unusually complete for this stage.
3. It explicitly resolves the real login.png/Registro.png provider mismatch with stated rationale instead of picking one silently.

## Priority Issues

- **[P0] No fast/browse path before the signup+SMS wall.** Why it matters: contradicts the core use case of someone opening the app because a pet is missing right now. Fix: define at minimum a read-only map/browse entry point, or a report-first-verify-after pattern. Suggested command: `/impeccable shape`.
- **[P0] Social login's relationship to SMS verification/badge is undefined.** Why it matters: the blue-checkmark trust model is PRODUCT.md's stated differentiator; leaving it unspecified for Google/Facebook/Apple sign-in is a real gap, not a detail. Fix: state explicitly whether social sign-in still requires the SMS step for the badge. Suggested command: `/impeccable clarify`.
- **[P1] No Android SMS autofill/OTP-retriever specified.** Why it matters: Android-only app, standard native friction-reducer, especially valuable under urgency. Fix: specify SMS Retriever API / autofill in the flow doc. Suggested command: `/impeccable optimize`.
- **[P1] No offline/network-failure states anywhere in the flow.** Why it matters: real risk for a Colombia-wide app on mobile data; silent failures risk duplicate submissions. Fix: add a network-error state per submit action. Suggested command: `/impeccable harden`.
- **[P2] Two mockup-vs-spec gaps left undocumented.** "Recordar sesión" default state (mockup: pre-checked) and the light/dark control being two icons, not one switch — both cheap to fix, both would mislead a builder working from the spec alone. Suggested command: `/impeccable clarify`.

## Persona Red Flags

**Jordan (First-Timer)**: Section "0. Onboarding" explicitly rules out any pre-login product context, so Jordan hits a bare login/register decision with zero framing. The SMS screen never specifies whether re-tapping box 3 to fix a typo is supported.

**Sam (Accessibility-Dependent)**: The doc's own Accessibility section defers itself entirely to a not-yet-written standard (#17). Concretely, "código incorrecto" says boxes clear and focus resets but never specifies an announced error for a screen-reader user — Sam would experience fields silently emptying with no explanation.

**Casey (Distracted Mobile)**: No section addresses offline/timeout/network-failure behavior for login, registration submit, or SMS send/verify — a real risk on Colombian mobile data, not a hypothetical.

## Minor Observations

- Password minimum length is deferred to issue #33 (reasonable) but the spec should say so explicitly rather than leaving "razonable" unquantified.
- Light/dark icons appear on both mockups but the spec only lists them under §1 Login, not restated in §2 Registro.

## Questions to Consider

- What would this flow look like if the first screen assumed the visitor already has an emergency, not that they're a new user signing up for an app?
- If social login skips SMS, does the blue badge mean something different for those accounts — and is that acceptable?
