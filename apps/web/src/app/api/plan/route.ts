import { auth } from '../../../auth.js';
import { getEnv } from '../../../runtime.js';
import { plan } from '../../../server/handlers.js';

export async function GET(request: Request) {
  const session = await auth();
  const s = session?.user?.email ? { email: session.user.email } : null;
  const date = new URL(request.url).searchParams.get('date') ?? undefined;
  const r = await plan(getEnv(), { session: s, query: { date } });
  return Response.json(r.body, { status: r.status });
}
