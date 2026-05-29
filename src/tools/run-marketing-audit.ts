import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerTool } from '../core/dispatcher';
import { getToolContext } from '../core/tool-context';
import { sendTelegramChatMessage } from '../integrations/telegram/send-message';
import { analyzeDimension, DIMENSION_LABELS, type DimensionKey, type DimensionResult } from '../lib/marketing-analyze';
import { logger } from '../core/logger';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);

const PYTHON = process.env.PYTHON_PATH ?? 'python3';
const PDF_SCRIPT = path.resolve(process.cwd(), 'scripts/marketing_pdf.py');

// ── Supabase upload for PDF ──────────────────────────────────────────────────
async function uploadPdfToStorage(buffer: Buffer, slug: string): Promise<string> {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados');

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/gi, '-').slice(0, 48) || 'audit';
    const storagePath = `marketing-audits/${safeSlug}-${Date.now()}.pdf`;

    const { error } = await supabase.storage
        .from('whatsapp-media')
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });

    if (error) throw new Error(`Error subiendo PDF: ${error.message}`);

    const { data: { publicUrl } } = supabase.storage
        .from('whatsapp-media')
        .getPublicUrl(storagePath);

    return publicUrl;
}

// ── Fetch page content ────────────────────────────────────────────────────────
function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}

async function fetchPageContent(url: string): Promise<string> {
    // Try Firecrawl first if available
    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (apiKey) {
        try {
            const { default: FirecrawlApp } = await import('@mendable/firecrawl-js');
            const app = new FirecrawlApp({ apiKey });
            const raw = await app.scrapeUrl(url, { formats: ['markdown'] }) as Record<string, unknown>;
            const md = (raw.markdown ?? (raw.data as Record<string,unknown>)?.markdown ?? '') as string;
            if (md) return md.slice(0, 12000);
        } catch { /* fall through */ }
    }
    // Basic fetch fallback
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgenteZirox-Audit/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al acceder a ${url}`);
    const html = await res.text();
    return stripHtml(html).slice(0, 12000);
}

// ── Score helpers ─────────────────────────────────────────────────────────────
function scoreBar(s: number): string {
    const f = Math.round(s / 10);
    return '█'.repeat(f) + '░'.repeat(10 - f);
}

function scoreEmoji(s: number): string {
    if (s >= 80) return '🟢';
    if (s >= 60) return '🟣';
    if (s >= 40) return '🟡';
    return '🔴';
}

function scoreLabel(s: number): string {
    if (s >= 80) return 'Excelente';
    if (s >= 60) return 'Bueno';
    if (s >= 40) return 'Regular';
    return 'Crítico';
}

// ── Report builder ────────────────────────────────────────────────────────────
function buildMarkdownReport(
    url: string,
    overallScore: number,
    dimensions: Record<DimensionKey, DimensionResult>
): string {
    const date = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const lines: string[] = [];

    lines.push(`# 📊 Auditoría de Marketing Digital`);
    lines.push(`**Web:** ${url}  |  **Fecha:** ${date}  |  Powered by AgenteZirox`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`## ${scoreEmoji(overallScore)} Puntuación Global: **${overallScore}/100** — ${scoreLabel(overallScore)}`);
    lines.push('');

    const dimKeys: DimensionKey[] = ['copy', 'seo', 'conversion', 'brand', 'strategy'];
    lines.push('### Resumen por dimensión');
    lines.push('');
    for (const key of dimKeys) {
        const d = dimensions[key];
        lines.push(`${scoreEmoji(d.score)} **${DIMENSION_LABELS[key]}** — ${d.score}/100  \`${scoreBar(d.score)}\``);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const key of dimKeys) {
        const d = dimensions[key];
        lines.push(`## ${scoreEmoji(d.score)} ${DIMENSION_LABELS[key]} — ${d.score}/100`);
        lines.push('');
        lines.push(d.summary);
        lines.push('');

        if (d.findings.length) {
            lines.push('**Hallazgos:**');
            for (const f of d.findings) lines.push(`- ${f}`);
            lines.push('');
        }
        if (d.quick_wins.length) {
            lines.push('**Acciones prioritarias:**');
            for (let i = 0; i < d.quick_wins.length; i++) lines.push(`${i + 1}. ${d.quick_wins[i]}`);
            lines.push('');
        }
        lines.push('---');
        lines.push('');
    }

    lines.push('*Generado por AgenteZirox · zirox.io*');
    return lines.join('\n');
}

// ── Tool registration ─────────────────────────────────────────────────────────
registerTool({
    name: 'run_marketing_audit',
    description:
        'Audita el marketing digital de cualquier web. Analiza 5 dimensiones en paralelo ' +
        '(copywriting, SEO, conversión, marca, estrategia) y genera un reporte con puntuaciones, ' +
        'hallazgos y acciones prioritarias. Opcionalmente genera un PDF profesional descargable. ' +
        'Úsalo cuando el usuario pida auditar, analizar o revisar el marketing de una web.',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'URL completa del sitio web a auditar (https://...)',
            },
            format: {
                type: 'string',
                enum: ['markdown', 'pdf'],
                description: 'Formato del reporte. "pdf" genera PDF descargable (~30s extra). Default: markdown.',
            },
        },
        required: ['url'],
    },
    timeoutMs: 150_000,
    handler: async (args) => {
        const url    = String(args.url ?? '').trim();
        const format = String(args.format ?? 'markdown').toLowerCase() === 'pdf' ? 'pdf' : 'markdown';

        if (!url.startsWith('http')) throw new Error('La URL debe empezar por https://');

        const tctx   = getToolContext();
        const chatId = tctx?.chatId ?? '';

        if (chatId) {
            sendTelegramChatMessage(
                chatId,
                `🔍 Analizando el marketing de ${url}...\nLanzando 5 agentes en paralelo (~30-60s)`
            ).catch(() => {});
        }

        // 1. Fetch page content
        logger.info(`[marketing-audit] fetching ${url}`);
        const content = await fetchPageContent(url);
        logger.info(`[marketing-audit] content: ${content.length} chars`);

        // 2. Run all 5 dimensions in parallel
        const dimKeys: DimensionKey[] = ['copy', 'seo', 'conversion', 'brand', 'strategy'];
        const results = await Promise.all(
            dimKeys.map(k => analyzeDimension(content, k))
        );

        const dimensions = Object.fromEntries(
            dimKeys.map((k, i) => [k, results[i]])
        ) as Record<DimensionKey, DimensionResult>;

        // 3. Compute overall score (weighted average)
        const WEIGHTS: Record<DimensionKey, number> = {
            copy:       0.25,
            seo:        0.20,
            conversion: 0.25,
            brand:      0.15,
            strategy:   0.15,
        };
        const overallScore = Math.round(
            dimKeys.reduce((acc, k) => acc + dimensions[k].score * WEIGHTS[k], 0)
        );

        logger.info(`[marketing-audit] overall: ${overallScore}`);

        // 4. Build markdown report
        const mdReport = buildMarkdownReport(url, overallScore, dimensions);

        if (format === 'markdown') {
            return mdReport;
        }

        // 5. PDF generation
        const tmpJson = path.join(tmpdir(), `maudit-${Date.now()}.json`);
        const tmpPdf  = path.join(tmpdir(), `maudit-${Date.now()}.pdf`);

        try {
            const payload = { url, overall_score: overallScore, dimensions };
            await fs.writeFile(tmpJson, JSON.stringify(payload, null, 2), 'utf8');

            const { stdout } = await execFileAsync(PYTHON, [PDF_SCRIPT, tmpJson, tmpPdf], {
                timeout: 60_000,
            });

            if (!stdout.trim().startsWith('OK:')) {
                logger.warn(`[marketing-audit] PDF script output: ${stdout}`);
            }

            const pdfBuffer = await fs.readFile(tmpPdf);
            const domain    = new URL(url).hostname.replace(/^www\./, '');
            const pdfUrl    = await uploadPdfToStorage(pdfBuffer, domain);

            logger.info(`[marketing-audit] PDF uploaded: ${pdfUrl}`);

            return [
                mdReport,
                '',
                '---',
                `📄 **PDF descargable:** ${pdfUrl}`,
            ].join('\n');

        } catch (pdfErr) {
            logger.warn(`[marketing-audit] PDF generation failed: ${pdfErr} — returning markdown`);
            return [
                mdReport,
                '',
                '> ⚠️ PDF no disponible (reportlab no instalado). Reporte en Markdown arriba.',
            ].join('\n');
        } finally {
            await Promise.all([
                fs.rm(tmpJson, { force: true }).catch(() => {}),
                fs.rm(tmpPdf,  { force: true }).catch(() => {}),
            ]);
        }
    },
});
