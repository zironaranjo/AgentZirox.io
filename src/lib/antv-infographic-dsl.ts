export type InfographicInput = {
    title: string;
    subtitle?: string;
    steps: string[];
    benefits: string[];
    template?: string;
};

/** Estilo editorial 2 columnas (más cercano a NotebookLM). */
const TEMPLATE_PRO = 'compare-hierarchy-left-right-circle-node-pill-badge';
const TEMPLATE_GRID = 'list-grid-badge-card';

function escLine(s: string): string {
    return String(s).replace(/\s+/g, ' ').trim();
}

export function coerceInfographicItems(value: unknown): string[] {
    const bad = new Set(['', 'undefined', 'null', '[object object]']);

    const push = (out: string[], raw: string) => {
        const t = escLine(raw);
        if (!t || bad.has(t.toLowerCase())) return;
        out.push(t);
    };

    if (Array.isArray(value)) {
        const out: string[] = [];
        for (const item of value) {
            if (item == null) continue;
            if (typeof item === 'string' || typeof item === 'number') {
                push(out, String(item));
                continue;
            }
            if (typeof item === 'object') {
                const o = item as Record<string, unknown>;
                const text = o.label ?? o.text ?? o.step ?? o.title ?? o.description ?? o.desc ?? o.name;
                if (text != null) push(out, String(text));
            }
        }
        return out;
    }

    if (typeof value === 'string' && value.trim()) {
        return value
            .split(/\n+|(?:\s*[,;]\s*)/)
            .map((s) => s.trim().replace(/^[-•*★]\s*|\d+[.)]\s*/, ''))
            .filter((s) => s && !bad.has(s.toLowerCase()));
    }

    return [];
}

function splitLabelDesc(raw: string, maxLabel = 32, maxDesc = 90): { label: string; desc: string } {
    const text = escLine(raw);
    if (!text || text.toLowerCase() === 'undefined') {
        return { label: 'Detalle', desc: '' };
    }
    if (text.length <= maxLabel) return { label: text, desc: '' };
    const cut = text.slice(0, maxLabel);
    const lastSpace = cut.lastIndexOf(' ');
    const label = ((lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim() || text.slice(0, maxLabel)) + '…';
    const rest = text.slice(lastSpace > 12 ? lastSpace : maxLabel).trim();
    const desc = rest.length > maxDesc ? rest.slice(0, maxDesc - 1) + '…' : rest;
    return { label, desc };
}

function pickIcon(text: string, fallback: string): string {
    const t = text.toLowerCase();
    if (/segur|proteg|privac|swiss|segur/.test(t)) return 'shield check';
    if (/rápid|veloc|instant|productiv|ahorr|12\s*h/.test(t)) return 'clock';
    if (/integr|ecosystem|crm|venta/.test(t)) return 'link';
    if (/automat|bot|agent|ia|ai|compliance/.test(t)) return 'robot';
    if (/telegram|chat|mensaj/.test(t)) return 'message';
    if (/banco|bank|reconcil|ledger/.test(t)) return 'wallet';
    if (/datos|data|central|report/.test(t)) return 'database';
    if (/memor|record|guard/.test(t)) return 'database';
    if (/estrés|estres|calma|organiz/.test(t)) return 'heart';
    if (/objetiv|meta|cumplir/.test(t)) return 'target';
    if (/prior|urgenc|clasif/.test(t)) return 'list check';
    if (/captur|anot|apunt/.test(t)) return 'edit';
    if (/benef|ventaj|éxito|exito/.test(t)) return 'star fill';
    return fallback;
}

function compareChildrenLines(items: string[], iconFallback: string, maxItems: number): string {
    return items
        .slice(0, maxItems)
        .map((raw) => {
            const { label, desc } = splitLabelDesc(raw, 28, 100);
            const icon = pickIcon(raw, iconFallback);
            const lines = [`        - label ${label}`, `          icon ${icon}`];
            if (desc) lines.push(`          desc ${desc}`);
            return lines.join('\n');
        })
        .join('\n');
}

function listItemLines(items: string[], iconFallback: string, tag: string, maxItems: number): string {
    return items.slice(0, maxItems).map((raw) => {
        const { label, desc } = splitLabelDesc(raw, 40, 80);
        const icon = pickIcon(raw, iconFallback);
        const head = tag ? `${tag}: ` : '';
        const lines = [`    - label ${head}${label}`, `      icon ${icon}`];
        if (desc) lines.push(`      desc ${desc}`);
        return lines.join('\n');
    }).join('\n');
}

function resolveStyle(): 'pro' | 'grid' | 'sequence' {
    const style = (process.env.INFOGRAPHIC_STYLE ?? 'pro').toLowerCase();
    const tpl = process.env.INFOGRAPHIC_ANTV_TEMPLATE?.trim().toLowerCase() ?? '';
    if (style === 'grid' || tpl === 'list-grid-badge-card') return 'grid';
    if (tpl.startsWith('sequence-') || style === 'sequence') return 'sequence';
    return 'pro';
}

const THEME_PRO = `theme
  palette #0d9488 #f97316 #3b82f6 #64748b
  base.text.fill #0f172a`;

const THEME_DARK = `theme
  palette #8b5cf6 #38bdf8 #34d399 #fbbf24
  base.text.fill #f8fafc`;

export function infographicHtmlBackground(): string {
    return resolveStyle() === 'pro' ? '#f1f5f9' : '#0f172a';
}

export function buildAntvInfographicDsl(input: InfographicInput): string {
    const title = escLine(input.title) || 'Infografía';
    const desc = escLine(input.subtitle ?? 'Generada por AgentZirox');
    const steps = coerceInfographicItems(input.steps);
    const benefits = coerceInfographicItems(input.benefits);
    const style = resolveStyle();

    if (steps.length < 2) throw new Error('Se necesitan al menos 2 pasos con texto válido');
    if (benefits.length < 2) throw new Error('Se necesitan al menos 2 beneficios con texto válido');

    if (style === 'pro') {
        const left = compareChildrenLines(steps, 'list check', 4);
        const right = compareChildrenLines(benefits, 'star fill', 4);
        return `infographic ${TEMPLATE_PRO}
data
  title ${title}
  desc ${desc}
  compares
    - label Cómo funciona
      icon arrow right
      children
${left}
    - label Beneficios
      icon star fill
      children
${right}
${THEME_PRO}`;
    }

    if (style === 'sequence') {
        const tpl = process.env.INFOGRAPHIC_ANTV_TEMPLATE?.trim() || 'sequence-ascending-steps';
        const sequences = steps
            .concat(benefits)
            .slice(0, 6)
            .map((raw) => {
                const { label, desc } = splitLabelDesc(raw);
                const icon = pickIcon(raw, 'arrow right');
                const lines = [`    - label ${label}`, `      icon ${icon}`];
                if (desc) lines.push(`      desc ${desc}`);
                return lines.join('\n');
            })
            .join('\n');
        return `infographic ${tpl}
data
  title ${title}
  desc ${desc}
  sequences
${sequences}
  order asc
${THEME_DARK}`;
    }

    const stepsBlock = listItemLines(steps, 'list check', 'Paso', 4);
    const benefitsBlock = listItemLines(benefits, 'star fill', 'Beneficio', 4);

    return `infographic ${TEMPLATE_GRID}
data
  title ${title}
  desc ${desc}
  lists
${stepsBlock}
${benefitsBlock}
${THEME_DARK}`;
}

export function buildAntvInfographicHtml(dsl: string, width = 1080, height = 1350): string {
    const dslJson = JSON.stringify(dsl);
    const version = '0.2.16';
    const bg = infographicHtmlBackground();
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${bg}; }
  #container { width: ${width}px; height: ${height}px; }
</style>
<script src="https://unpkg.com/@antv/infographic@${version}/dist/infographic.min.js"><\/script>
</head>
<body>
<div id="container"></div>
<script>
(function () {
  const dsl = ${dslJson};
  const info = new AntVInfographic.Infographic({
    container: '#container',
    width: ${width},
    height: ${height},
    padding: [40, 48, 40, 48],
    editable: false,
  });
  window.__INFO_READY__ = false;
  window.__INFO_ERROR__ = null;
  info.on('loaded', function () { window.__INFO_READY__ = true; });
  info.on('error', function (e) {
    window.__INFO_ERROR__ = JSON.stringify(e);
  });
  info.render(dsl);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { info.render(dsl); }).catch(function () {});
  }
})();
<\/script>
</body>
</html>`;
}
