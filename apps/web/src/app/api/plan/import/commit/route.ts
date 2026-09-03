import { auth } from '../../../../../auth.js';
import { getEnv } from '../../../../../runtime.js';
import { importPlanCommit } from '../../../../../server/handlers.js';

export async function POST(request: Request) {
  const session = await auth();
  const s = session?.user?.email ? { email: session.user.email } : null;
  const body = await request.json().catch(() => null);
  const r = await importPlanCommit(getEnv(), { session: s, body });
  return Response.json(r.body, { status: r.status });
}
