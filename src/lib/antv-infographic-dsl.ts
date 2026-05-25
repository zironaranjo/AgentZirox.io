export type InfographicInput = {
    title: string;
    subtitle?: string;
    steps: string[];
    benefits: string[];
    template?: string;
};

/** Evita solapamiento: cuadrícula con tarjetas (no compare-binary). */
const DEFAULT_TEMPLATE = 'list-grid-badge-card';

function escLine(s: string): string {
    return String(s).replace(/\s+/g, ' ').trim();
}

/** Título corto en la tarjeta + detalle en desc (AntV lo maquetea bien). */
function splitLabelDesc(raw: string, maxLabel = 36, maxDesc = 72): { label: string; desc: string } {
    const text = escLine(raw);
    if (text.length <= maxLabel) return { label: text, desc: '' };
    const cut = text.slice(0, maxLabel);
    const lastSpace = cut.lastIndexOf(' ');
    const label = (lastSpace > 18 ? cut.slice(0, lastSpace) : cut).trim() + '…';
    const rest = text.slice(lastSpace > 18 ? lastSpace : maxLabel).trim();
    const desc = rest.length > maxDesc ? rest.slice(0, maxDesc - 1) + '…' : rest;
    return { label, desc };
}

function pickIcon(text: string, fallback: string): string {
    const t = text.toLowerCase();
    if (/segur|proteg|privac/.test(t)) return 'shield check';
    if (/rápid|veloc|instant|productiv/.test(t)) return 'flash fast';
    if (/ahorr|cost|precio|tiempo/.test(t)) return 'clock';
    if (/memor|record|guard|postgres/.test(t)) return 'database';
    if (/automat|bot|agent|ia|ai/.test(t)) return 'robot';
    if (/telegram|chat|mensaj/.test(t)) return 'message';
    if (/obsidian|nota|doc/.test(t)) return 'document text';
    if (/estrés|estres|calma|organiz/.test(t)) return 'heart';
    if (/objetiv|meta|cumplir/.test(t)) return 'target';
    if (/prior|urgenc|clasif/.test(t)) return 'list check';
    if (/captur|anot|apunt/.test(t)) return 'edit';
    if (/revis|actualiz/.test(t)) return 'refresh';
    if (/benef|ventaj|éxito|exito/.test(t)) return 'star fill';
    return fallback;
}

function listItemLines(
    items: string[],
    iconFallback: string,
    prefix: string,
    maxItems: number
): string {
    return items.slice(0, maxItems).map((raw, i) => {
        const { label, desc } = splitLabelDesc(raw);
        const icon = pickIcon(raw, iconFallback);
        const lines = [`    - label ${prefix}${i + 1}. ${label}`, `      icon ${icon}`];
        if (desc) lines.push(`      desc ${desc}`);
        return lines.join('\n');
    }).join('\n');
}

/**
 * DSL AntV: título + cuadrícula de pasos y beneficios (legible, sin PROS/CONS).
 */
export function buildAntvInfographicDsl(input: InfographicInput): string {
    const title = escLine(input.title);
    const desc = escLine(input.subtitle ?? 'Generada por AgentZirox');
    const template = input.template?.trim() || DEFAULT_TEMPLATE;

    const stepCount = Math.min(input.steps.length, 4);
    const benefitCount = Math.min(input.benefits.length, 4);
    const steps = listItemLines(input.steps, 'arrow right', '', stepCount);
    const benefits = listItemLines(input.benefits, 'star fill', '★ ', benefitCount);

    return `infographic ${template}
data
  title ${title}
  desc ${desc}
  lists
${steps}
${benefits}
theme
  palette #8b5cf6 #38bdf8 #34d399 #fbbf24
  base.text.fill #f8fafc`;
}

export function buildAntvInfographicHtml(dsl: string, width = 1080, height = 1350): string {
    const dslJson = JSON.stringify(dsl);
    const version = '0.2.16';
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #0f172a; }
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
    padding: [32, 40, 32, 40],
    editable: false,
  });
  window.__INFO_READY__ = false;
  window.__INFO_ERROR__ = null;
  info.on('loaded', function () { window.__INFO_READY__ = true; });
  info.on('error', function (e) {
    window.__INFO_ERROR__ = String(e && e.message ? e.message : e);
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
