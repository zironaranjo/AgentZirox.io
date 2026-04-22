import { NextResponse } from 'next/server';
import { initMemory } from '../../../../core/memory';
import { runDailySelfImprove } from '../../../../core/daily-self-improve';

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
        const result = await runDailySelfImprove(token);
        return jsonForResult(result);
    } catch (e) {
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}

export async function GET(req: Request) {
    return POST(req);
}

function jsonForResult(result: Awaited<ReturnType<typeof runDailySelfImprove>>) {
    switch (result.status) {
        case 'disabled':
            return NextResponse.json({ ok: false, status: 'disabled' }, { status: 503 });
        case 'unauthorized':
            return NextResponse.json({ ok: false, status: 'unauthorized' }, { status: 401 });
        case 'already_run':
            return NextResponse.json({ ok: true, status: 'already_run', day: result.day });
        case 'skipped_low_activity':
            return NextResponse.json({
                ok: true,
                status: 'skipped_low_activity',
                userMessages: result.userMessages,
            });
        case 'ok':
            return NextResponse.json({
                ok: true,
                status: 'ok',
                day: result.day,
                insightsAdded: result.insightsAdded,
                preview: result.rawPreview,
            });
        case 'error':
            return NextResponse.json({ ok: false, status: 'error', error: result.message }, { status: 502 });
        default:
            return NextResponse.json({ ok: false }, { status: 500 });
    }
}
