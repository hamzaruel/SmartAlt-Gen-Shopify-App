import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    const query = router.query;

    // Preserve Shopify embedded params (shop, host, embedded, …) on the way in.
    if (query && Object.keys(query).length > 0) {
      router.replace({ pathname: '/dashboard', query });
      return;
    }

    router.replace('/dashboard');
  }, [router.isReady]);

  return null;
}
