// import crypto from 'crypto';
// import { NextResponse } from 'next/server';
// import axios from 'axios';
// import { storeShop } from '@/lib/db';

// export const runtime = 'nodejs';
// export const dynamic = 'force-dynamic';

// /**
//  * Verify Shopify HMAC
//  */
// function verifyHmac(queryParams, hmac, secret) {
//   const params = { ...queryParams };
//   delete params.hmac;
//   delete params.signature;

//   const sorted = Object.keys(params)
//     .sort()
//     .map((key) => {
//       const value = Array.isArray(params[key])
//         ? params[key].join(',')
//         : params[key];
//       return `${key}=${value}`;
//     })
//     .join('&');

//   const hash = crypto.createHmac('sha256', secret).update(sorted).digest('hex');
//   return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac));
// }

// /**
//  * Register app/uninstalled webhook
//  */
// async function registerUninstallWebhook(shop, accessToken) {
//   return axios.post(
//     `https://${shop}/admin/api/2024-01/webhooks.json`,
//     {
//       webhook: {
//         topic: 'app/uninstalled',
//         address: `${process.env.SHOPIFY_HOST}/api/webhooks/app-uninstalled`,
//         format: 'json',
//       },
//     },
//     {
//       headers: {
//         'X-Shopify-Access-Token': accessToken,
//         'Content-Type': 'application/json',
//       },
//     }
//   );
// }

// export async function GET(request) {
//   console.log('🔵 OAuth callback started');

//   const url = new URL(request.url);
//   const searchParams = url.searchParams;

//   const shop = searchParams.get('shop');
//   const code = searchParams.get('code');
//   const hmac = searchParams.get('hmac');
//   const state = searchParams.get('state');

//   console.log('🔍 OAuth params - shop:', shop, 'code exists:', !!code, 'hmac exists:', !!hmac, 'state exists:', !!state);

//   if (!shop || !code || !hmac) {
//     console.log('❌ Missing required OAuth parameters');
//     return NextResponse.json({ error: 'Missing required OAuth parameters' }, { status: 400 });
//   }

//   // 1️⃣ Validate OAuth state (CSRF)
//   const cookiesHeader = request.headers.get('cookie') || '';
//   const stateCookie = cookiesHeader
//     .split(';')
//     .map((c) => c.trim())
//     .find((c) => c.startsWith('shopify_oauth_state='));
//   const storedState = stateCookie ? stateCookie.split('=')[1] : null;

//   console.log('🔍 State validation - received:', state, 'stored:', storedState);
//   if (!state || !storedState || state !== storedState) {
//     console.log('❌ Invalid OAuth state');
//     return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
//   }

//   // 2️⃣ Verify Shopify HMAC
//   const queryParamsObj = {};
//   for (const [key, value] of searchParams.entries()) {
//     queryParamsObj[key] = value;
//   }
//   const apiSecret = process.env.SHOPIFY_API_SECRET;

//   console.log('🔍 Verifying HMAC...');
//   if (!verifyHmac(queryParamsObj, hmac, apiSecret)) {
//     console.log('❌ HMAC validation failed');
//     return NextResponse.json({ error: 'HMAC validation failed' }, { status: 400 });
//   }
//   console.log('✅ HMAC validation passed');

//   // 3️⃣ Exchange code for access token
//   try {
//     console.log('🔵 Starting token exchange for shop:', shop);

//     const tokenResponse = await axios.post(
//       `https://${shop}/admin/oauth/access_token`,
//       {
//         client_id: process.env.SHOPIFY_API_KEY,
//         client_secret: process.env.SHOPIFY_API_SECRET,
//         code,
//       },
//       { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
//     );

//     const { access_token, scope } = tokenResponse.data;
//     console.log('✅ Received access token - length:', access_token?.length, 'prefix:', access_token?.substring(0, 15), 'scopes:', scope);

//     // 4️⃣ Store token securely in DB
//     const stored = storeShop(shop, access_token, scope);
//     console.log('💾 storeShop() returned:', stored);
//     if (!stored) console.error('❌ Failed to store shop credentials');
//     else console.log('✅ Successfully stored shop credentials');

//     // 5️⃣ Register uninstall webhook
//     try {
//       console.log('🔔 Registering uninstall webhook...');
//       await registerUninstallWebhook(shop, access_token);
//       console.log('✅ Uninstall webhook registered');
//     } catch (e) {
//       console.error('⚠️ Failed to register uninstall webhook', e?.response?.data || e.message);
//     }

//     // 6️⃣ Redirect to app
//         // 6️⃣ Redirect back to embedded app in Shopify admin
//     const shopDomain = shop;
//     const appHandle = 'sitemap-explorer2-test'; // Your app handle from Dev Dashboard
//     const redirectUrl = `https://${shopDomain}/admin/apps/${appHandle}`;

//     console.log('🔄 Redirecting to embedded app:', redirectUrl);
    
//     const response = NextResponse.redirect(redirectUrl);
//     response.cookies.set('shopify_oauth_state', '', { 
//       httpOnly: true, 
//       secure: true, 
//       sameSite: 'lax', 
//       path: '/', 
//       maxAge: 0 
//     });

//     console.log('✅ OAuth callback completed successfully');
//     return response;
//   } catch (err) {
//     console.error('❌ Error exchanging code for access token:', err?.response?.data || err.message);
//     return NextResponse.json({ error: 'Failed to obtain access token' }, { status: 500 });
//   }
// }






import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { storeShop } from '@/lib/db';
import { resolveAppUrl } from '@/lib/appUrl';
import { BASE_PATH } from '@/lib/basePath';

export const dynamic = 'force-dynamic';
//new one test
export async function GET(request) {
  console.log('🔵 ===== OAuth Callback Started =====');

  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const hmac = searchParams.get('hmac');
  const state = searchParams.get('state');

  console.log('📋 Params:', { 
    shop, 
    hasCode: !!code, 
    hasHmac: !!hmac, 
    hasState: !!state 
  });
  


  // 1. Validate params
 // if (!shop || !code || !hmac) {
   // console.error('❌ Missing OAuth parameters');
   // return NextResponse.json({ 
     // error: 'Missing required parameters',
     // received: { shop: !!shop, code: !!code, hmac: !!hmac }
   // }, { status: 400 });
 // }

if (!shop || !code || !hmac) {
  console.log('⚠️ Invalid callback params - redirecting');
  const redirectUrl = shop
    ? `https://${shop}/admin/apps`
    : 'https://admin.shopify.com?error=invalid_params';
 
 return NextResponse.redirect(redirectUrl);
}


  // 2. Verify state
  const cookies = request.cookies;
  const savedState = cookies.get('shopify_oauth_state')?.value;

  console.log('🔐 State check:', { 
    received: state, 
    saved: savedState, 
    match: savedState === state 
  });

//  if (!savedState || savedState !== state) {
  //  console.error('❌ State mismatch');
   // return NextResponse.json({ error: 'Invalid state' }, { status: 403 });
 // }

if (!savedState || savedState !== state) {
  console.log('⚠️ State mismatch - redirecting');
  return NextResponse.redirect(`https://${shop}/admin/apps`);
}


  try {
    // 3. Verify HMAC
    const params = Object.fromEntries(searchParams.entries());
    delete params.hmac;
    delete params.signature;
    
    const message = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');

    const generatedHash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(message)
      .digest('hex');

    // Constant-time compare (avoids timing leaks), with a length guard since
    // crypto.timingSafeEqual throws on differing buffer lengths.
    const hmacValid =
      typeof hmac === 'string' &&
      hmac.length === generatedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(generatedHash, 'utf8'),
        Buffer.from(hmac, 'utf8'),
      );

    if (!hmacValid) {
      console.log('⚠️ HMAC mismatch - redirecting');
      return NextResponse.redirect(`https://${shop}/admin/apps`);
    }


    console.log('✅ HMAC verified');

    // 4. Exchange code for token
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    console.log('🔄 Exchanging code at:', tokenUrl);

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    console.log('📡 Token response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token exchange failed:', errorText);
      // Don't leak internals to the browser — send the merchant back to their apps.
      return NextResponse.redirect(`https://${shop}/admin/apps`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, scope } = tokenData;

    console.log('✅ Token received, scopes:', scope);
    console.log('🔑 Token preview:', access_token?.substring(0, 10) + '...');

    // 5. Store in database
    console.log('💾 Storing shop in database...');
    console.log('📊 DB Config check:', {
      hasUrl: !!process.env.TURSO_DATABASE_URL,
      hasToken: !!process.env.TURSO_AUTH_TOKEN
    });

    const stored = await storeShop(shop, access_token);
// 🔐 Register mandatory GDPR webhooks
// const gdprTopics = [
 // { topic: 'CUSTOMERS_DATA_REQUEST', path: 'customers/data_request' },
 // { topic: 'CUSTOMERS_REDACT', path: 'customers/redact' },
 // { topic: 'SHOP_REDACT', path: 'shop/redact' },
// ];

// for (const t of gdprTopics) {
 // const res = await fetch(
   // `https://${shop}/admin/api/2025-01/webhooks.json`,
   // {
     // method: 'POST',
     // headers: {
       // 'X-Shopify-Access-Token': access_token,
       // 'Content-Type': 'application/json',
     // },
     // body: JSON.stringify({
       // webhook: {
         // topic: t.topic,
         // address: `${process.env.SHOPIFY_HOST}/sitemap-explorer/api/webhooks/${t.path}`,
         // format: 'json',
       // },
     // }),
   // }
 // );

 // if (!res.ok) {
   // console.error(`❌ Failed GDPR webhook: ${t.topic}`);
 // } else {
   // console.log(`✅ GDPR webhook registered: ${t.topic}`);
 // }
// }
    

    console.log('💾 Store result:', stored ? '✅ Success' : '❌ Failed');

    if (!stored) {
      console.error('❌ Database storage failed');
      return NextResponse.json({ 
        error: 'Failed to store credentials' 
      }, { status: 500 });
    }

    console.log('✅ Shop stored successfully:', shop);


   // after storing shop in DB



    // 6. Register webhook previous working
    try {
    // const webhookUrl = `${process.env.SHOPIFY_HOST}/sitemap-explorer/api/webhooks/app-uninstalled`;

const webhookUrl = `${resolveAppUrl(request)}${BASE_PATH}/api/webhooks/app-uninstalled`;


      console.log('🔔 Registering webhook:', webhookUrl);

     const webhookResponse = await fetch(
 `https://${shop}/admin/api/2025-01/webhooks.json`,
        {
          method: 'POST',
         headers: {
           'X-Shopify-Access-Token': access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook: {
              topic: 'app/uninstalled',
              address: webhookUrl,
              format: 'json',
            },
          }),
        }
      );

      if (webhookResponse.ok) {
        console.log('✅ Webhook registered');
      } else {
        const webhookError = await webhookResponse.text();
        console.error('⚠️ Webhook failed:', webhookError);
      }
    } catch (webhookError) {
      console.error('⚠️ Webhook error:', webhookError);
    }



    // 7. Redirect to app
    // const appUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_APP_HANDLE}`;
    // console.log('🔄 Redirecting to:', appUrl);
    // console.log('🔵 ===== OAuth Callback Complete =====');

    // redirect url working now 

  // ✅ Let Shopify redirect to the app automatically
// Get host parameter for embedded app redirect
const shopSlug = shop.replace('.myshopify.com', '');
const appHandle = process.env.SHOPIFY_APP_HANDLE;

let redirectUrl;

if (appHandle) {
  // Redirect into the embedded app home (SmartAltGen dashboard)
  redirectUrl = `https://admin.shopify.com/store/${shopSlug}/apps/${appHandle}`;

  console.log('🔄 Redirecting directly to app:', redirectUrl);
} else {
  redirectUrl = `https://admin.shopify.com/store/${shopSlug}/apps`;
  console.error('⚠️ SHOPIFY_APP_HANDLE not set! Add it to environment variables.');
}

const response = NextResponse.redirect(redirectUrl);
response.cookies.delete('shopify_oauth_state');

return response;


  }
 catch (error) {
    console.error('❌ FATAL ERROR in callback:', error);
    console.error('Stack:', error.stack);
    // Never expose stack traces / internals to the browser. Redirect cleanly so a
    // mid-install failure doesn't surface a raw error page to the merchant.
    return NextResponse.redirect(
      shop ? `https://${shop}/admin/apps` : 'https://admin.shopify.com',
    );
  }
}
