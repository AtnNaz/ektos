import { listSessions } from '@/lib/db';
import { type Session, summarise } from '@/lib/experiment';

export async function GET(request: Request) {
  void request.url;
  try {
    const sessions = listSessions().map(s => JSON.parse(s.data) as Session);
    return Response.json(summarise(sessions));
  } catch {
    return Response.json({ error: 'database not available' }, { status: 500 });
  }
}
