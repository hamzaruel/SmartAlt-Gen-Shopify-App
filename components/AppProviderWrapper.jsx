'use client';

import { useSearchParams } from 'next/navigation';
import AppProvider from './AppProvider';

export default function AppProviderWrapper({ children }) {
  const searchParams = useSearchParams();
  const host = searchParams.get('host');

  console.log('🔹 AppProviderWrapper detected host:', host);

  return <AppProvider host={host}>{children}</AppProvider>;
}
