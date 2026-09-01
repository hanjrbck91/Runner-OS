import { auth } from '../../../auth.js';
import { getEnv } from '../../../runtime.js';
import { today } from '../../../server/handlers.js';

export async function GET() {
  const session = await auth();
  const s = session?.user?.email ? { email: session.user.email } : null;
  const r = await today(getEnv(), { session: s });
  return Response.json(r.body, { status: r.status });
}
