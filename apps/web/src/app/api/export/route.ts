import { auth } from '../../../auth.js';
import { getEnv } from '../../../runtime.js';
import { exportWeek } from '../../../server/handlers.js';

export async function GET(request: Request) {
  const session = await auth();
  const s = session?.user?.email ? { email: session.user.email } : null;
  const week = new URL(request.url).searchParams.get('week') ?? undefined;
  const r = await exportWeek(getEnv(), { session: s, query: { week } });
  if (r.csv !== undefined) {
    return new Response(r.csv, {
      status: r.status,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${r.filename}"`,
        'cache-control': 'no-store',
      },
    });
  }
  return Response.json(r.body, { status: r.status });
}
