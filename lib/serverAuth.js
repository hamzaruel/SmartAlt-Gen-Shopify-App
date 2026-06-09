import { getAccessToken, storeShop } from './db';
import { exchangeSessionToken } from './tokenExchange';

// Resolve a usable Admin API token for an API route.
// Preferred path: the embedded client sends `Authorization: Bearer <sessionToken>`,
// which we exchange for a fresh (expiring) offline token and cache in Turso.
// Fallback: whatever token is already stored (used if no session token is sent).
export async function getShopToken(request, shop) {
  const auth = request.headers.get('authorization') || '';
  const sessionToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (sessionToken) {
    try {
      // Request an ONLINE token: it always expires, which Shopify now requires
      // (offline tokens via exchange come back non-expiring and are rejected).
      // Our flow is user-driven and re-exchanges a fresh session token each call.
      const token = await exchangeSessionToken(shop, sessionToken, { online: true });
      await storeShop(shop, token); // cache the fresh token
      return token;
    } catch (e) {
      console.error('⚠️ token exchange failed, falling back to stored token:', e.message);
    }
  }
  return getAccessToken(shop);
}
