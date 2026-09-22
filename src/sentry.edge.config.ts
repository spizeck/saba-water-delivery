import * as Sentry from "@sentry/nextjs";

import { buildSentryInitOptions } from "@/lib/monitoring/sentryShared";

const options = buildSentryInitOptions("edge");
if (options.enabled) {
  Sentry.init(options);
}
