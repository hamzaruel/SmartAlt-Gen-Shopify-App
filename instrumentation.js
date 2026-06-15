// Next.js startup hook (runs once when the server process boots). We use it to
// start the scheduled bulk-edit ticker. Guarded to the Node.js runtime so it
// never tries to run on the Edge runtime (where setInterval/DB aren't available).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler');
    startScheduler();
  }
}
