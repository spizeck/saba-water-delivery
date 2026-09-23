import * as Sentry from "@sentry/nextjs";

import { buildSentryInitOptions } from "@/lib/monitoring/sentryShared";

// Browser bundles only receive NEXT_PUBLIC_* values when they appear as
// literal `process.env.NAME` member expressions — webpack replaces those
// statically at build time. Dynamic access (passing `process.env` through to
// `resolveSentryEnv` and reading `env.NEXT_PUBLIC_*` there) is not
// analyzable, so the browser shim would resolve every value to `undefined`
// and Sentry would never initialize. These references MUST stay direct
// (guarded by instrumentationClientEnv.test.ts).
const options = buildSentryInitOptions("client", {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  NODE_ENV: process.env.NODE_ENV,
});
if (options.enabled) {
  Sentry.init(options);
}

// Required by the SDK for navigation instrumentation — a no-op here since
// performance tracing is disabled (tracesSampleRate: 0).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
