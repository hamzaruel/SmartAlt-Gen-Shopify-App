import '@/app/globals.css';
import { AppProvider as PolarisProvider } from '@shopify/polaris';
import translations from '@shopify/polaris/locales/en.json';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const host = router.query.host;

  useEffect(() => {
    if (host && typeof window !== 'undefined' && window.shopify && !window.shopify.app) {
      const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY;
      window.shopify.app = window.shopify.createApp({
        apiKey: apiKey,
        host: host,
      });
      console.log('✅ App Bridge initialized from CDN');
    }
  }, [host]);

  return (
    <PolarisProvider i18n={translations}>
      <Component {...pageProps} />
    </PolarisProvider>
  );
}


