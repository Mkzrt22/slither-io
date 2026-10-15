import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0.05, dataCollection: { userInfo: false, cookies: false, httpBodies: [], genAI: { inputs: false, outputs: false } } });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
