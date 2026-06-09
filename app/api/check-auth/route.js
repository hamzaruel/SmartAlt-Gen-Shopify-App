// import { NextResponse } from 'next/server';
// import { getAccessToken } from '@/lib/db';

// export const dynamic = 'force-dynamic';

// export async function GET(request) {
//   try {
//     const url = new URL(request.url);
//     const shop = url.searchParams.get('shop');

//     if (!shop) {
//       return NextResponse.json({ authenticated: false });
//     }

//     const token = getAccessToken(shop);
//     return NextResponse.json({ authenticated: !!token });
//   } catch (err) {
//     console.error('check-auth error:', err);
//     return NextResponse.json({ authenticated: false });
//   }
// }

// working
// import { NextResponse } from 'next/server';
// import { getAccessToken } from '@/lib/db';

// export const runtime = 'nodejs';
// export const dynamic = 'force-dynamic';

// export async function GET(request) {
//   const url = new URL(request.url);
//   const shop = url.searchParams.get('shop');

//   if (!shop) {
//     return NextResponse.json({ authorized: false, error: 'Missing shop' }, { status: 400 });
//   }

//   const token = getAccessToken(shop);

//   // Return JSON, not redirect!
//   return NextResponse.json({
//     authorized: !!token,
//     shop: shop
//   });
// }

// new test 
// app/api/check-auth/route.js
// import { NextResponse } from 'next/server';
// import { getAccessToken } from '@/lib/db';

// export const dynamic = 'force-dynamic';

// export async function GET(request) {
//   try {
//     const { searchParams } = new URL(request.url);
//     const shop = searchParams.get('shop');

//     if (!shop) {
//       return NextResponse.json({ authorized: false }, { status: 400 });
//     }

//     const token = await getAccessToken(shop);

//     return NextResponse.json({
//       authorized: !!token,
//       shop
//     });
//   } catch (error) {
//     console.error('Auth check error:', error);
//     return NextResponse.json({ 
//       authorized: false, 
//       error: error.message 
//     }, { status: 500 });
//   }
// }
import { NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');

    console.log('🔍 Check auth called for shop:', shop);

    if (!shop) {
      console.log('❌ No shop parameter provided');
      return NextResponse.json({ 
        authorized: false, 
        error: 'Missing shop' 
      }, { status: 400 });
    }

    console.log('🔄 Attempting to get token from database...');
    const token = await getAccessToken(shop);
    
    console.log('📊 Token result:', token ? '✅ Found' : '❌ Not found');

    return NextResponse.json({
      authorized: !!token,
      shop: shop
    });
  } catch (error) {
    console.error('❌ Auth check error:', error);
    return NextResponse.json({ 
      authorized: false, 
      error: error.message || 'Auth check failed' 
    }, { status: 500 });
  }
}





