'use client';

import '@shopify/polaris/build/esm/styles.css';
import { AppProvider as PolarisProvider } from '@shopify/polaris';
import translations from '@shopify/polaris/locales/en.json';

// Navigation is handled by <ui-nav-menu> in app/layout.js (App Bridge v4),
// so this just provides the Polaris context.
export default function AppProvider({ children }) {
  return <PolarisProvider i18n={translations}>{children}</PolarisProvider>;
}
