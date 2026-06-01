import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { logger } from '../core/logger';
import { coerceInfographicItems } from '../lib/antv-infographic-dsl';
import { archiveInfographicToNeurona } from '../lib/infographic-neurona';
import { runNotebooklmInfographic } from '../lib/notebooklm-infographic';
import { updateInfographicJobPng, uploadInfographicPng } from '../core/storage';
import { setPendingTelegramImageCaption, setPendingTelegramImageUrl } from './generate-image';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';

const DEFAULT_WEBHOOK = 'https://ziroxxn8n.ziroxn8n.site/webhook/agent-infografia-notebooklm';

type NotebooklmJobResponse = {
    success?: boolean;
    job_id?: number | string;
    title?: string;
    slug?: string;
    guion_preview?: string;
    guion_md?: string;
    error?: string;
    message?: string;
};

function webhookUrl(): string {
    return (process.env.N8N_NOTEBOOKLM_INFOGRAPHIC_WEBHOOK_URL ?? DEFAULT_WEBHOOK).trim();
}

function n8nEnabled(): boolean {
    const v = (process.env.N8N_NOTEBOOKLM_INFOGRAPHIC_ENABLED ?? 'true').toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'no';
}

async function callN8nJob(payload: Record<string, unknown>): Promise<NotebooklmJobResponse> {
    if (!n8nEnabled()) return {};

    const res = await fetch(webhookUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: NotebooklmJobResponse = {};
    if (text.trim()) {
        try {
            data = JSON.parse(text) as NotebooklmJobResponse;
        } catch {
            throw new Error(`Respuesta inválida de n8n NotebookLM (${res.status}): ${text.slice(0, 300)}`);
        }
    }

    if (!res.ok) throw new Error(data.error ?? `Webhook n8n HTTP ${res.status}`);
    if (data.success === false) throw new Error(data.error ?? data.message ?? 'Error al registrar job NotebookLM');
    return data;
}

function buildGuion(title: string, subtitle: string, steps: string[], benefits: string[]): string {
    const stepLines = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const benefitLines = benefits.map((b) => `- ${b}`).join('\n');
    return `# Infografía NotebookLM: ${title}\n\n## ${subtitle}\n\n## Pasos\n${stepLines}\n\n## Beneficios\n${benefitLines}`;
}

registerTool({
    name: 'create_infographic_notebooklm',
    description:
        'Crea infografía PREMIUM con Google NotebookLM (calidad editorial tipo NotebookLM app): ' +
        'PNG listo, envío por Telegram y archivo en Obsidian. Usar cuando pidan calidad premium, ' +
        'estilo NotebookLM, o adjunten URLs/PDFs como fuentes. Tarda 2–8 min. ' +
        'Para infografías rápidas usa create_infographic (AntV).',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Título principal' },
            subtitle: { type: 'string', description: 'Subtítulo opcional' },
            brief: { type: 'string', description: 'Resumen o contexto adicional para NotebookLM' },
            steps: {
                type: 'array',
                items: { type: 'string' },
                description: 'Pasos clave (3–5 frases cortas)',
            },
            benefits: {
                type: 'array',
                items: { type: 'string' },
                description: 'Beneficios (3–5 frases cortas)',
            },
            sources: {
                type: 'array',
                items: { type: 'string' },
                description: 'URLs, YouTube o fuentes web para enriquecer la infografía (opcional)',
            },
            instructions: {
                type: 'string',
                description: 'Instrucciones extra de diseño para NotebookLM (opcional)',
            },
        },
        required: ['title'],
    },
    timeoutMs: 720_000,
    handler: async (args) => {
        const ctx = getToolContext();
        const a = args as {
            title?: string;
            subtitle?: string;
            brief?: string;
            steps?: unknown;
            benefits?: unknown;
            sources?: unknown;
            instructions?: string;
        };

        const title = String(a.title ?? '').trim();
        const subtitle = String(a.subtitle ?? 'Generada por AgentZirox · NotebookLM').trim();
        const brief = String(a.brief ?? '').trim();
        const steps = coerceInfographicItems(a.steps);
        const benefits = coerceInfographicItems(a.benefits);
        const sources = Array.isArray(a.sources)
            ? a.sources.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
            : [];

        if (!title) throw new Error('title vacío');
        if (!brief && steps.length < 2 && benefits.length < 2 && sources.length === 0) {
            throw new Error(
                'Necesitas brief, steps/benefits (mín. 2) o sources[] con URLs para NotebookLM.'
            );
        }

        const chatId = ctx?.chatId ?? 'global';
        const guionMd = buildGuion(title, subtitle, steps, benefits);
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);

        const job = await callN8nJob({
            action: 'create',
            chat_id: chatId,
            title,
            subtitle,
            brief,
            steps,
            benefits,
            sources,
            slug,
            provider: 'notebooklm',
        });

        const jobId = Number(job.job_id);

        if (ctx?.chatId && !ctx.chatId.startsWith('wa_')) {
            void sendTelegramChatMessage(
                ctx.chatId,
                '⏳ Generando infografía con NotebookLM (suele tardar **3–8 min**). Te envío el PNG y el borrador de LinkedIn cuando termine.'
            ).catch((e) => logger.warn('[create_infographic_notebooklm] Aviso Telegram:', e));
        }

        const { pngBuffer, notebookId, taskId } = await runNotebooklmInfographic({
            title,
            brief: brief || subtitle,
            steps,
            benefits,
            sources,
            instructions: String(a.instructions ?? '').trim() || undefined,
            language: 'es',
            orientation: 'portrait',
            detail: 'standard',
        });

        const uploaded = await uploadInfographicPng(pngBuffer, chatId, `${slug}-nlm`);
        const pngUrl = uploaded.publicUrl;

        if (Number.isFinite(jobId) && jobId > 0) {
            try {
                await updateInfographicJobPng(jobId, pngUrl);
            } catch (e) {
                logger.warn('[create_infographic_notebooklm] No se actualizó job en Postgres', e);
            }
        }

        if (ctx?.chatId) {
            setPendingTelegramImageUrl(ctx.chatId, pngUrl);
            setPendingTelegramImageCaption(ctx.chatId, `📊 ${title} · NotebookLM`);
        }

        const neurona = await archiveInfographicToNeurona({
            description: `${title} (NotebookLM)`,
            pngUrl,
            designUrl: notebookId ? `notebooklm:${notebookId}` : 'notebooklm',
            origin: 'NotebookLM auto',
        });

        const lines = [
            `✅ Infografía NotebookLM lista${jobId ? ` (#${jobId})` : ''}: **${title}**`,
            '🖼️ Calidad editorial — imagen enviada por Telegram.',
            taskId ? `🧠 task: ${taskId}` : '',
            `🔗 PNG: ${pngUrl}`,
            neurona.ok ? `📓 ${neurona.note}` : `⚠️ ${neurona.note}`,
            '',
            '**Guion:**',
            job.guion_preview ?? guionMd.slice(0, 800),
        ].filter(Boolean);

        return lines.join('\n');
    },
});
