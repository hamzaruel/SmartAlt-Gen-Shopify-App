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
const nextConfig = {
  // basePath/assetPrefix removed: SmartAltGen serves at root so `shopify app dev`
  // tunnel (which points at root) loads the embedded app correctly.
  output: 'standalone',
  experimental: {
    outputFileTracingIncludes: {
      '/': ['./middleware.js'],
    },
    serverComponentsExternalPackages: ['mongodb'],
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

