import './globals.css';
import { Suspense } from 'react';

export const metadata = {
  title: 'Alt Text Pro',
  description: 'Generate WCAG-compliant alt text for your Shopify product images.',
};

export default function RootLayout({ children }) {
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY;

  return (
    <html lang="en">
      <head>
        {/* App Bridge must be the first script and needs the api key meta tag. */}
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body>
        {/* Navigation (<s-app-nav>) lives in app/(app)/layout.jsx so it can keep
            the shop/host query params on each link. */}
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
