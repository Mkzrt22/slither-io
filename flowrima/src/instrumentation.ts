import * as Sentry from "@sentry/nextjs";

/** Server-side error monitoring (Sentry). No-op when SENTRY_DSN is not set. */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // RGPD: no user info, cookies, bodies or lyrics (gen AI inputs/outputs) sent to Sentry
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], genAI: { inputs: false, outputs: false } },
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  });
}

export const onRequestError = Sentry.captureRequestError;
