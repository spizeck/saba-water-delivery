import * as Sentry from "@sentry/nextjs";

import { buildSentryInitOptions } from "@/lib/monitoring/sentryShared";

const options = buildSentryInitOptions("client");
if (options.enabled) {
  Sentry.init(options);
}

// Required by the SDK for navigation instrumentation — a no-op here since
// performance tracing is disabled (tracesSampleRate: 0).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
