# Integrations

[Home](Home.md) · Technical reference: [INTEGRATIONS.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/INTEGRATIONS.md) · Setup: [DEPLOYMENT.md](https://github.com/spizeck/saba-water-delivery/blob/main/docs/DEPLOYMENT.md)

Status reviewed against repository code/docs, ownership issues, and the project owner's WhatsApp clarification on 12 September 2026. Implemented support is different from verified production activation. This review did not inspect private provider consoles or credentials.

| Service                       | Current classification                                                           | What staff should understand                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google authentication         | Active sign-in path in the application; Firebase ownership remains pilot-managed | The login form offers Google. Government control of the underlying Firebase project and authorized domains remains part of #56/#59. This is not a live provider health test.                                                                                                                          |
| Email/password authentication | Active sign-in and account-creation path                                         | Residents can use an account without Facebook. Authentication is separate from roles and driver eligibility.                                                                                                                                                                                          |
| Resend                        | Implemented and configured for the developer-owned pilot, as described in #58    | Sends account invitations, delivery-review messages, and continuity reports. Government account/sending-domain/credential ownership remains open. Configuration does not guarantee each message arrives.                                                                                              |
| WhatsApp ordering             | Future resident feature; not available to live residents                         | Code includes a resident conversation and webhook, requiring provider credentials and Meta provisioning. Repository instructions do not prove a government number is provisioned or Live mode enabled. The project owner confirms it is future functionality; deployed credentials remain unverified. |
| Facebook authentication       | Planned/not enabled in the login UI                                              | The button is disabled and says Coming Soon. Provider scaffolding exists, but users cannot start Facebook login from it.                                                                                                                                                                              |

## What the status words mean

**Implemented** means the software has a path for the feature. **Configured**
means its required settings have been supplied, which source code alone cannot
prove. **Enabled in deployment** means the running service is activated with
its provider. **Available to users** means residents or staff can actually use
that path. **Future** means it must not be presented as a current service even
when implementation already exists.

For WhatsApp, the first is verified in code and the last is confirmed by the
project owner. Production configuration and activation have not been inspected;
it is not currently available to live residents. For Facebook, the user-facing
path is explicitly disabled in code regardless of any provider configuration.
For Google and email, the application supports current pilot use, but this
review is not a live authentication or email-delivery test.

The same distinction applies to infrastructure: a backup runbook does not enable
PITR, a health endpoint does not configure alerts, and a deployment does not
transfer its account ownership. See [Production Handover](Production-Handover.md)
for each area's evidence and outstanding verification.

## Email behavior

Delivery-review email follows recorded delivery. A failure does not roll back delivery, keep a driver busy, or extend the resident's review window. Unregistered requestors are not sent an authenticated delivery-review link. If continuity email fails, staff can still download a report while the application is available. Durable notification retry is future work in [#53](https://github.com/spizeck/saba-water-delivery/issues/53).

## Messaging and login boundaries

WhatsApp ordering, if enabled, uses the same application and Firestore data as website requests; it cannot serve as an independent fallback for a Vercel or Firestore outage. Driver WhatsApp workflows and proactive delivery templates are outside the implemented resident conversation. An office WhatsApp contact link is not evidence that automated ordering is active.

Facebook Login and WhatsApp are separate Meta products with separate activation requirements. The login button is hard-disabled; a reviewed application change is needed as well as provider readiness. The stale incident-guide statement about enabling it without a code change is corrected in this PR.

See [Production Handover](Production-Handover.md) for [Firebase #56](https://github.com/spizeck/saba-water-delivery/issues/56), [Resend #58](https://github.com/spizeck/saba-water-delivery/issues/58), and [domain #59](https://github.com/spizeck/saba-water-delivery/issues/59). Detailed source conflicts and implementation references are recorded in the [draft README](README.md).
