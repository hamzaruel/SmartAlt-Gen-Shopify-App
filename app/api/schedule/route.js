import { NextResponse } from 'next/server';
import { getShopToken } from '@/lib/serverAuth';
import { createTask, listTasks, deleteTask } from '@/lib/scheduledTasks';

export const dynamic = 'force-dynamic';

const RECURRENCES = new Set(['once', 'daily', 'weekly']);

// GET /api/schedule?shop=...  → list this shop's scheduled bulk-edit tasks.
export async function GET(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ tasks: await listTasks(shop) });
  } catch (e) {
    console.error('schedule list error:', e);
    return NextResponse.json({ tasks: [] });
  }
}

// POST /api/schedule?shop=...  → create a task.
// body: { sources:[], mode, template, scope, skipExisting, infoFields:[], instructions,
//         recurrence:'once'|'daily'|'weekly', timeLabel:'HH:MM', nextRunAt:<epoch ms> }
// nextRunAt is computed CLIENT-side (knows the merchant's timezone).
export async function POST(request) {
  const shop = new URL(request.url).searchParams.get('shop');
  if (!shop) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (!body.mode) return NextResponse.json({ error: 'Missing edit mode' }, { status: 400 });
  if (!RECURRENCES.has(body.recurrence)) return NextResponse.json({ error: 'Invalid recurrence' }, { status: 400 });
  const nextRunAt = Number(body.nextRunAt);
  if (!Number.isFinite(nextRunAt) || nextRunAt <= 0) {
    return NextResponse.json({ error: 'Invalid run time' }, { status: 400 });
  }

  try {
    const task = await createTask(shop, {
      sources: Array.isArray(body.sources) ? body.sources : [],
      mode: body.mode,
      template: body.template || '',
      scope: body.scope === 'all' ? 'all' : 'missing',
      skipExisting: !!body.skipExisting,
      infoFields: Array.isArray(body.infoFields) ? body.infoFields : [],
      instructions: (body.instructions || '').toString().slice(0, 400),
      recurrence: body.recurrence,
      timeLabel: (body.timeLabel || '').toString().slice(0, 8),
      nextRunAt,
    });
    return NextResponse.json({ task });
  } catch (e) {
    console.error('schedule create error:', e);
    return NextResponse.json({ error: 'Could not create the scheduled task.' }, { status: 500 });
  }
}

// DELETE /api/schedule?shop=...&id=...  → remove a task.
export async function DELETE(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const id = url.searchParams.get('id');
  if (!shop || !id) return NextResponse.json({ error: 'Missing shop or id' }, { status: 400 });
  const token = await getShopToken(request, shop);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await deleteTask(shop, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('schedule delete error:', e);
    return NextResponse.json({ error: 'Could not delete the task.' }, { status: 500 });
  }
}
