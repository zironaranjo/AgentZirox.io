import { NextResponse } from 'next/server';
import { initMemory } from '../../../../core/memory';
import { runDueScheduledTasks } from '../../../../core/process-scheduled';

function extractBearer(req: Request): string | null {
    const auth = req.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
    const h = req.headers.get('x-cron-secret');
    return h?.trim() ?? null;
}

export async function POST(req: Request) {
    try {
        await initMemory();
        const token = extractBearer(req);
        const result = await runDueScheduledTasks(token);

        if (result.status === 'disabled') {
            return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
        }
        if (result.status === 'unauthorized') {
            return NextResponse.json({ ok: false, status: 'unauthorized' }, { status: 401 });
        }
        return NextResponse.json({
            ok: true,
            processed: result.processed,
            errors: result.errors,
        });
    } catch (e) {
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}

export async function GET(req: Request) {
    return POST(req);
}
