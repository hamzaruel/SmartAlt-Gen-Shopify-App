'use client';

// Get a fresh App Bridge session token (id_token). App Bridge v4 is loaded via
// the CDN script in app/layout.js, exposing window.shopify.idToken().
export async function getSessionToken() {
  if (typeof window !== 'undefined' && window.shopify?.idToken) {
    try {
      return await window.shopify.idToken();
    } catch {
      return null;
    }
  }
  return null;
}

// Build fetch headers with the Bearer session token (plus any extras).
export async function authHeaders(extra = {}) {
  const token = await getSessionToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}
