import "./env"; // ensure .env is loaded before we read process.env

export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID?.trim() ?? "";
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET?.trim() ?? "";
export const oauthConfigured = Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);

// Where GitHub redirects back to — MUST match the OAuth App's callback URL.
export const OAUTH_CALLBACK =
  process.env.FACTORY_OAUTH_CALLBACK?.trim() ||
  `http://localhost:${process.env.PORT ?? 8787}/api/github/callback`;

// Where to send the browser after the OAuth dance completes (the app itself).
export const APP_URL = process.env.FACTORY_APP_URL?.trim() || "http://localhost:5173";
