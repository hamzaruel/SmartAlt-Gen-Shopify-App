require('dotenv').config();

// PM2 process for SmartAltGen on the VPS, served under /smart-alt-gen via nginx.
// Mirrors the a11y-gen setup: Next standalone server on a dedicated port,
// bound to localhost so only nginx can reach it.
module.exports = {
  apps: [
    {
      name: "smart-alt-gen",
      script: ".next/standalone/server.js",
      cwd: "/var/www/smart-alt-gen",
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        HOSTNAME: "127.0.0.1",

        // Subpath this app is mounted under (must also be in .env for the build).
        NEXT_PUBLIC_BASE_PATH: "/smart-alt-gen",

        SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
        SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
        SHOPIFY_APP_HANDLE: process.env.SHOPIFY_APP_HANDLE,
        SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES,
        SHOPIFY_HOST: process.env.SHOPIFY_HOST,

        NEXT_PUBLIC_SHOPIFY_API_KEY: process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,

        TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
        TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,

        GEMINI_API_KEY: process.env.GEMINI_API_KEY,

        // Billing: set "true" in .env to force Shopify TEST charges (no real money)
        // while QA-ing. Leave unset/false for real charges at launch.
        SHOPIFY_BILLING_TEST: process.env.SHOPIFY_BILLING_TEST,
      },
    },
  ],
};
