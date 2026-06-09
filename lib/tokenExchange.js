// OAuth token exchange — swaps an App Bridge session token (id_token) for a
// valid Admin API access token. Required because Shopify no longer accepts the
// non-expiring offline tokens produced by the legacy authorization-code grant.
// Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange

const OFFLINE = 'urn:shopify:params:oauth:token-type:offline-access-token';
const ONLINE = 'urn:shopify:params:oauth:token-type:online-access-token';

export async function exchangeSessionToken(shop, sessionToken, { online = false } = {}) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: online ? ONLINE : OFFLINE,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('Token exchange returned no access_token');
  }
  return json.access_token;
}
