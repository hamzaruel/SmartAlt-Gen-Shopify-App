// import crypto from 'crypto';
// import { NextResponse } from 'next/server';

// export const dynamic = 'force-dynamic';

// export async function GET(request) {
//   const { searchParams } = new URL(request.url);
//   const shop = searchParams.get('shop');

//   console.log('🔵 Auth route called with shop:', shop);

//   // 1. Validate shop param
//   if (!shop || !shop.endsWith('.myshopify.com')) {
//     console.error('❌ Invalid shop parameter:', shop);
//     return NextResponse.json(
//       { error: 'Missing or invalid shop parameter' },
//       { status: 400 }
//     );
//   }

//   const apiKey = process.env.SHOPIFY_API_KEY;
//   const scopes = process.env.SHOPIFY_SCOPES;
//   const host = process.env.SHOPIFY_HOST;

//   console.log('📝 Environment check:', { apiKey: !!apiKey, scopes: !!scopes, host: !!host });

//   if (!apiKey || !scopes || !host) {
//     console.error('❌ Missing environment variables');
//     return NextResponse.json(
//       { error: 'Shopify environment variables are not configured' },
//       { status: 500 }
//     );
//   }

//   // 2. Redirect URI (must match your app settings)
//   const redirectUri = `${host}/api/auth/callback`;

//   // 3. Create CSRF state (nonce)
//   const state = crypto.randomBytes(16).toString('hex');

//   // 4. Build Shopify authorization URL
//   const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
//   authUrl.searchParams.set('client_id', apiKey);
//   authUrl.searchParams.set('scope', scopes);
//   authUrl.searchParams.set('redirect_uri', redirectUri);
//   authUrl.searchParams.set('state', state);

//   console.log('🔗 Redirecting to:', authUrl.toString());

//   // 5. Store state in a cookie and redirect
//   const response = NextResponse.redirect(authUrl.toString());
// const isProd = process.env.NODE_ENV === 'production';

// response.cookies.set('shopify_oauth_state', state, {
//   httpOnly: true,
//   secure: isProd,              // ✅ localhost: false
//   sameSite: isProd ? 'none' : 'lax',
//   path: '/',
//   maxAge: 60 * 10,
// });


//   return response;
// }

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { resolveAppUrl } from '@/lib/appUrl';
import { BASE_PATH } from '@/lib/basePath';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop');

  console.log('🔵 Auth route called with shop:', shop);
  


  // 1. Validate shop param
  if (!shop || !shop.endsWith('.myshopify.com')) {
    console.error('❌ Invalid shop parameter:', shop);
    return NextResponse.json(
      { error: 'Missing or invalid shop parameter' },
      { status: 400 }
    );
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const scopes = process.env.SHOPIFY_SCOPES;
  const host = resolveAppUrl(request);

  // Debug: shows which source the app URL came from (check terminal).
  console.log('🔎 app URL resolution:', {
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
    HOST: process.env.HOST,
    x_forwarded_host: request.headers.get('x-forwarded-host'),
    host_header: request.headers.get('host'),
    resolved: host,
  });
  console.log('📝 Environment check:', { apiKey: !!apiKey, scopes: !!scopes, host });

  if (!apiKey || !scopes || !host) {
    console.error('❌ Missing environment variables');
    return NextResponse.json(
      { error: 'Shopify environment variables are not configured' },
      { status: 500 }
    );
  }




  // 2. Build redirect URI (remove trailing slash from host)
  const cleanHost = host.replace(/\/$/, '');
  // const redirectUri = `${cleanHost}/api/auth/callback`;
 // const redirectUri = `${cleanHost}/sitemap-explorer/api/auth/callback`;

const redirectUri = `${cleanHost}${BASE_PATH}/api/auth/callback`;

  console.log('🔗 Redirect URI:', redirectUri);

  // 3. Create CSRF state
  const state = crypto.randomBytes(16).toString('hex');

  // 4. Build Shopify authorization URL
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set('client_id', apiKey);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  console.log('🔗 Full auth URL:', authUrl.toString());

  // 5. Set cookie and redirect
  const response = NextResponse.redirect(authUrl.toString());
  const isProd = process.env.NODE_ENV === 'production';

  response.cookies.set('shopify_oauth_state', state, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: 60 * 10,
  });

  return response;
}
