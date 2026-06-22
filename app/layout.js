import './globals.css';
import { Suspense } from 'react';
import { Inter, Sora } from 'next/font/google';

// Body / paragraph font (clean, highly readable) and a distinct display font
// for all headings. Exposed as CSS variables so globals.css can apply them
// (body → Inter, h1–h6 → Sora) for a consistent type system app-wide.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap', weight: ['500', '600', '700', '800'] });

export const metadata = {
  title: 'Alt Text Pro',
  description: 'Generate WCAG-compliant alt text for your Shopify product images.',
};

export default function RootLayout({ children }) {
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY;

  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
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
