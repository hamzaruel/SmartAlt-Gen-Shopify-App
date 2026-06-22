// const nextConfig = {
//   output: 'standalone',
//   images: {
//     unoptimized: true,
//   },
//   experimental: {
//     // Remove if not using Server Components
//     serverComponentsExternalPackages: ['mongodb'],
//   },
//   webpack(config, { dev }) {
//     if (dev) {
//       // Reduce CPU/memory from file watching
//       config.watchOptions = {
//         poll: 2000, // check every 2 seconds
//         aggregateTimeout: 300, // wait before rebuilding
//         ignored: ['**/node_modules'],
//       };
//     }
//     return config;
//   },
//   onDemandEntries: {
//     maxInactiveAge: 10000,
//     pagesBufferLength: 2,
//   },
//   async headers() {
//     return [
//       {
//         source: "/(.*)",
//         headers: [          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS || "*" },
//           { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
//           { key: "Access-Control-Allow-Headers", value: "*" },
//         ],
//       },
//     ];
//   },
// };

// module.exports = nextConfig;




// server version updated. wokring previously 

// const nextConfig = {
//   output: 'standalone',
//   images: {
//     unoptimized: true,
//   },
//   experimental: {
//     // Remove if not using Server Components
//     serverComponentsExternalPackages: ['mongodb'],
//   },
//   webpack(config, { dev }) {
//     if (dev) {
//       // Reduce CPU/memory from file watching
//       config.watchOptions = {
//         poll: 2000, // check every 2 seconds
//         aggregateTimeout: 300, // wait before rebuilding
//         ignored: ['**/node_modules'],
//       };
//     }
//     return config;
//   },
//   onDemandEntries: {
//     maxInactiveAge: 10000,
//     pagesBufferLength: 2,
//   },
//   async headers() {
//     return [
//       {
//         source: "/(.*)",
//         headers: [
//           {
//             key: "Access-Control-Allow-Origin",
//             value: process.env.CORS_ORIGINS || "*",
//           },
//           {
//             key: "Access-Control-Allow-Methods",
//             value: "GET, POST, PUT, DELETE, OPTIONS",
//           },
//           {
//             key: "Access-Control-Allow-Headers",
//             value: "*",
//           },
//         ],
//       },
//     ];
//   },
// };

// module.exports = nextConfig;


// test version for middleware
// Production (VPS behind nginx) serves the app under a subpath, set via
// NEXT_PUBLIC_BASE_PATH (e.g. "/smart-alt-gen"). Local `shopify app dev` leaves
// it unset, so the app serves at root and the dev tunnel keeps working.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  output: 'standalone',
  experimental: {
    outputFileTracingIncludes: {
      '/': ['./middleware.js'],
    },
    serverComponentsExternalPackages: ['mongodb'],
    // Enables instrumentation.js register() — used to boot the scheduled bulk-edit
    // ticker once when the server process starts.
    instrumentationHook: true,
  },
  images: {
    unoptimized: true,
  },
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        poll: 2000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

