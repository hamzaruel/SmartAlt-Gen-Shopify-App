// Turso (libsql) — TOKEN-ONLY store.
// This DB intentionally holds NOTHING but the shop access token.
// All image data is fetched live from Shopify and held client-side; we never
// persist product/file/article image rows here.
import { createClient } from '@libsql/client';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('❌ MISSING TURSO CREDENTIALS!');
  console.error('TURSO_DATABASE_URL:', !!process.env.TURSO_DATABASE_URL);
  console.error('TURSO_AUTH_TOKEN:', !!process.env.TURSO_AUTH_TOKEN);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Initialize schema — just the shops/token table.
const initSchema = async () => {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS shops (
        shop TEXT PRIMARY KEY,
        access_token TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Schema initialized (token-only)');
  } catch (e) {
    console.error('❌ Schema error:', e);
  }
};

initSchema();

// ==================== SHOP / TOKEN FUNCTIONS ====================

export const storeShop = async (shop, accessToken) => {
  try {
    await db.execute({
      sql: `
        INSERT INTO shops (shop, access_token)
        VALUES (?, ?)
        ON CONFLICT(shop) DO UPDATE SET access_token = excluded.access_token
      `,
      args: [shop, accessToken],
    });
    console.log('✅ Token stored for', shop);
    return true;
  } catch (e) {
    console.error('❌ storeShop error:', e);
    return false;
  }
};

export const getAccessToken = async (shop) => {
  try {
    const result = await db.execute({
      sql: 'SELECT access_token FROM shops WHERE shop = ?',
      args: [shop],
    });
    return result.rows[0]?.access_token ?? null;
  } catch (e) {
    console.error('❌ getAccessToken error:', e);
    return null;
  }
};

export const deleteShop = async (shop) => {
  try {
    await db.execute({ sql: 'DELETE FROM shops WHERE shop = ?', args: [shop] });
    console.log(`✅ Deleted: ${shop}`);
    return true;
  } catch (e) {
    console.error('❌ Delete error:', e);
    return false;
  }
};

export const shopExists = async (shop) => {
  try {
    const result = await db.execute({
      sql: 'SELECT 1 FROM shops WHERE shop = ?',
      args: [shop],
    });
    return result.rows.length > 0;
  } catch (e) {
    console.error('❌ shopExists error:', e);
    return false;
  }
};

export default db;
