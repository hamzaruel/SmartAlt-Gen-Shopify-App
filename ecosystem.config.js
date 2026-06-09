require('dotenv').config();

module.exports = {
  apps: [
    {
      name: "a11y-gen",
      script: ".next/standalone/server.js",
      cwd: "/var/www/a11y-gen",
      env: {
        NODE_ENV: "production",
        PORT: 3003,
        HOSTNAME: "127.0.0.1",

        SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
        SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
        SHOPIFY_APP_HANDLE: process.env.SHOPIFY_APP_HANDLE,
        SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES,
        SHOPIFY_HOST: process.env.SHOPIFY_HOST,

        NEXT_PUBLIC_SHOPIFY_API_KEY: process.env.NEXT_PUBLIC_SHOPIFY_API_KEY,

        TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
        TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
      }
    }
  ]
};


