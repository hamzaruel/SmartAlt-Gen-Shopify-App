// Subpath the app is mounted under in production (e.g. "/smart-alt-gen" behind
// nginx on the VPS). Empty during local `shopify app dev`, where the app serves
// at root. The NEXT_PUBLIC_ prefix means the value is inlined into both the
// server and the browser bundles, so client fetches and server redirect URLs
// stay in sync from a single source of truth.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Prefix an app-relative path (e.g. "/api/scan") with the base path.
export const withBase = (path) => `${BASE_PATH}${path}`;
