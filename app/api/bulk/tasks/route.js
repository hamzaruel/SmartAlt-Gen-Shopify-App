import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { listTaskLogs } from '@/lib/bulkTaskLog';

export const dynamic = 'force-dynamic';

// GET /api/bulk/tasks?shop=...&limit=20&offset=0
// History of every bulk-edit run (manual + scheduled) for the "Bulk edit tasks"
// page. Newest first, paginated.
export async function GET(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = Number(url.searchParams.get('limit')) || 20;
  const offset = Number(url.searchParams.get('offset')) || 0;
  try {
    const data = await listTaskLogs(shop, { limit, offset });
    return NextResponse.json(data);
  } catch (e) {
    console.error('bulk tasks list error:', e);
    return NextResponse.json({ logs: [], total: 0, limit, offset });
  }
}
