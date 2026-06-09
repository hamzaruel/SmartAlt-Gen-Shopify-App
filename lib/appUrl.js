// Resolve the app's public base URL for OAuth redirect_uri / webhook addresses.
// During `shopify app dev` the CLI injects the app URL (SHOPIFY_APP_URL / HOST);
// in production we use SHOPIFY_HOST. Request headers are the last resort.
export function resolveAppUrl(request) {
  const clean = (u) => (u || '').replace(/\/$/, '');

  if (process.env.SHOPIFY_APP_URL) return clean(process.env.SHOPIFY_APP_URL);
  if (process.env.HOST && /^https?:\/\//.test(process.env.HOST)) {
    return clean(process.env.HOST);
  }
  if (process.env.NODE_ENV !== 'production' && request) {
    const fwdHost =
      request.headers.get('x-forwarded-host') || request.headers.get('host');
    const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
    if (fwdHost) return `${fwdProto}://${fwdHost}`;
  }
  return clean(process.env.SHOPIFY_HOST);
}
