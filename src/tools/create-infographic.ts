import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { logger } from '../core/logger';
import { buildAntvInfographicDsl, coerceInfographicItems } from '../lib/antv-infographic-dsl';
import { renderAntvInfographicToPng } from '../lib/infographic-render';
import { archiveInfographicToNeurona } from '../lib/infographic-neurona';
import { updateInfographicJobPng, uploadInfographicPng } from '../core/storage';
import { setPendingTelegramImageCaption, setPendingTelegramImageUrl } from './generate-image';

const DEFAULT_WEBHOOK = 'https://ziroxxn8n.ziroxn8n.site/webhook/agent-crear-infografia';

type CreateInfographicResponse = {
    success?: boolean;
    action?: string;
    job_id?: number | string;
    title?: string;
    slug?: string;
    message?: string;
    guion_preview?: string;
    guion_md?: string;
    antv_dsl?: string;
    png_url?: string;
    neurona_updated?: boolean;
    neurona_note?: string;
    error?: string;
};

function webhookUrl(): string {
    return (process.env.N8N_CREATE_INFOGRAPHIC_WEBHOOK_URL ?? DEFAULT_WEBHOOK).trim();
}

function isEnabled(): boolean {
    const v = (process.env.N8N_CREATE_INFOGRAPHIC_ENABLED ?? 'true').toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'no';
}

async function callCreateInfographic(payload: Record<string, unknown>): Promise<CreateInfographicResponse> {
    if (!isEnabled()) {
        throw new Error(
            'Crear infografía vía n8n desactivado. Activa N8N_CREATE_INFOGRAPHIC_ENABLED=true.'
        );
    }

    const res = await fetch(webhookUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: CreateInfographicResponse = {};
    if (text.trim()) {
        try {
            data = JSON.parse(text) as CreateInfographicResponse;
        } catch {
            throw new Error(`Respuesta inválida de n8n (${res.status}): ${text.slice(0, 300)}`);
        }
    }

    if (!res.ok) throw new Error(data.error ?? `Webhook n8n HTTP ${res.status}`);
    if (data.success === false) throw new Error(data.error ?? data.message ?? 'Error al crear infografía');
    return data;
}

registerTool({
    name: 'create_infographic',
    description:
        'Crea una infografía COMPLETA con AntV Infographic (~200 plantillas): guion, diseño profesional, PNG 1080×1350, ' +
        'envío por Telegram y archivo en Obsidian. OBLIGATORIO cuando pidan crear/hacer una infografía. ' +
        'Envía title + steps[] + benefits[]. El usuario NO diseña nada.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Título principal de la infografía (promesa clara)' },
            subtitle: { type: 'string', description: 'Subtítulo opcional (1 línea)' },
            steps: {
                type: 'array',
                items: { type: 'string' },
                description: 'Pasos (3–4 ítems, frases cortas ~8 palabras, sin párrafos largos)',
            },
            benefits: {
                type: 'array',
                items: { type: 'string' },
                description: 'Beneficios (3–4 ítems, frases cortas ~8 palabras)',
            },
            example_input: { type: 'string', description: 'Ejemplo de prompt (opcional)' },
            example_output: { type: 'string', description: 'Ejemplo de resultado (opcional)' },
        },
        required: ['title', 'steps', 'benefits'],
    },
    timeoutMs: 240_000,
    handler: async (args) => {
        const ctx = getToolContext();
        const a = args as {
            title?: string;
            subtitle?: string;
            steps?: unknown;
            benefits?: unknown;
            example_input?: string;
            example_output?: string;
        };

        const title = String(a.title ?? '').trim();
        const subtitle = String(a.subtitle ?? 'Generada por AgentZirox').trim();
        const steps = coerceInfographicItems(a.steps);
        const benefits = coerceInfographicItems(a.benefits);
        if (!title) throw new Error('title vacío');
        if (steps.length < 2) {
            throw new Error(
                'steps inválidos: envía un array de strings cortos (ej. ["Captura por Telegram","Prioriza tareas"]). No uses objetos vacíos.'
            );
        }
        if (benefits.length < 2) {
            throw new Error('benefits inválidos: envía frases cortas en array de strings.');
        }

        const chatId = ctx?.chatId ?? 'global';

        const data = await callCreateInfographic({
            action: 'create',
            chat_id: chatId,
            title,
            subtitle,
            steps,
            benefits,
            example_input: String(a.example_input ?? '').trim(),
            example_output: String(a.example_output ?? '').trim(),
            brand: 'zirox',
        });

        const jobId = Number(data.job_id);
        // Siempre DSL local (n8n antv_dsl puede llevar "undefined" si steps llegan como objetos)
        const dsl = buildAntvInfographicDsl({ title, subtitle, steps, benefits });

        logger.info('[create_infographic] Renderizando AntV Infographic → PNG…');
        const pngBuffer = await renderAntvInfographicToPng(dsl);
        const slug = String(data.slug ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);
        const uploaded = await uploadInfographicPng(pngBuffer, chatId, slug);
        const pngUrl = uploaded.publicUrl;

        if (Number.isFinite(jobId) && jobId > 0) {
            try {
                await updateInfographicJobPng(jobId, pngUrl);
            } catch (e) {
                logger.warn('[create_infographic] No se actualizó job en Postgres', e);
            }
        }

        if (ctx?.chatId) {
            setPendingTelegramImageUrl(ctx.chatId, pngUrl);
            setPendingTelegramImageCaption(ctx.chatId, `📊 ${title}`);
        }

        const neurona = await archiveInfographicToNeurona({
            description: title,
            pngUrl,
            designUrl: 'antv:list-grid-badge-card',
            origin: 'AntV Infographic auto',
        });

        const lines = [
            `✅ Infografía AntV lista${jobId ? ` (#${jobId})` : ''}: **${title}**`,
            '🖼️ Imagen enviada por Telegram — diseño automático, sin Canva.',
            `🔗 PNG: ${pngUrl}`,
            neurona.ok ? `📓 ${neurona.note}` : `⚠️ ${neurona.note}`,
            '',
            '**Guion:**',
            data.guion_preview ?? data.guion_md?.slice(0, 600) ?? '',
        ].filter(Boolean);

        return lines.join('\n');
    },
});
