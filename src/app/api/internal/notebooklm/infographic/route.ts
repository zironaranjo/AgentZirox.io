import { NextResponse } from 'next/server';

import { archiveInfographicToNeurona } from '../../../../lib/infographic-neurona';
import { runNotebooklmInfographic } from '../../../../lib/notebooklm-infographic';
import { updateInfographicJobPng, uploadInfographicPng } from '../../../../core/storage';

function extractSecret(req: Request): string | null {
    const auth = req.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
    return req.headers.get('x-cron-secret')?.trim() ?? null;
}

function authorized(req: Request): boolean {
    const token = extractSecret(req);
    const secret =
        process.env.NOTEBOOKLM_INTERNAL_SECRET?.trim() ||
        process.env.CRON_SECRET?.trim() ||
        process.env.SELF_IMPROVE_CRON_SECRET?.trim();
    if (!secret) return false;
    return token === secret;
}

export async function POST(req: Request) {
    if (!authorized(req)) {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    try {
        const body = (await req.json()) as {
            title?: string;
            brief?: string;
            subtitle?: string;
            steps?: string[];
            benefits?: string[];
            sources?: string[];
            instructions?: string;
            chat_id?: string;
            slug?: string;
            job_id?: number;
        };

        const title = String(body.title ?? '').trim();
        if (!title) {
            return NextResponse.json({ ok: false, error: 'title requerido' }, { status: 400 });
        }

        const chatId = String(body.chat_id ?? 'global').trim() || 'global';
        const slug =
            String(body.slug ?? title)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .slice(0, 48) || 'infografia-nlm';

        const { pngBuffer, notebookId, taskId } = await runNotebooklmInfographic({
            title,
            brief: String(body.brief ?? body.subtitle ?? '').trim() || undefined,
            steps: body.steps,
            benefits: body.benefits,
            sources: body.sources,
            instructions: body.instructions,
            language: 'es',
            orientation: 'portrait',
            detail: 'standard',
        });

        const uploaded = await uploadInfographicPng(pngBuffer, chatId, `${slug}-nlm`);
        const pngUrl = uploaded.publicUrl;

        const jobId = Number(body.job_id);
        if (Number.isFinite(jobId) && jobId > 0) {
            await updateInfographicJobPng(jobId, pngUrl);
        }

        const neurona = await archiveInfographicToNeurona({
            description: `${title} (NotebookLM)`,
            pngUrl,
            designUrl: notebookId ? `notebooklm:${notebookId}` : 'notebooklm',
            origin: 'NotebookLM API interna',
        });

        return NextResponse.json({
            ok: true,
            success: true,
            png_url: pngUrl,
            notebook_id: notebookId,
            task_id: taskId,
            neurona_updated: neurona.ok,
            neurona_note: neurona.note,
        });
    } catch (e) {
        return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
}
