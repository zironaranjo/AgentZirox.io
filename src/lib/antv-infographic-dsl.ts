export type InfographicInput = {
    title: string;
    subtitle?: string;
    steps: string[];
    benefits: string[];
    template?: string;
};

const DEFAULT_TEMPLATE = 'compare-binary-horizontal-simple-fold';

/** Escapa texto para líneas del DSL AntV (sin saltos ni indentación extra). */
function escLine(s: string): string {
    return String(s).replace(/\s+/g, ' ').trim();
}

function pickIcon(text: string, fallback: string): string {
    const t = text.toLowerCase();
    if (/segur|proteg|privac/.test(t)) return 'shield check';
    if (/rápid|veloc|instant|fast/.test(t)) return 'flash fast';
    if (/ahorr|cost|precio|gratis/.test(t)) return 'wallet';
    if (/memor|record|guard/.test(t)) return 'database';
    if (/automat|bot|agent|ia|ai/.test(t)) return 'robot';
    if (/telegram|chat|mensaj/.test(t)) return 'message';
    if (/obsidian|nota|doc/.test(t)) return 'document text';
    if (/linkedin|social|post/.test(t)) return 'share';
    if (/tarea|todo|lista|paso/.test(t)) return 'list check';
    if (/benef|ventaj|result|éxito|exito/.test(t)) return 'star fill';
    return fallback;
}

function childLines(items: string[], iconFallback: string): string {
    return items
        .slice(0, 8)
        .map((raw, i) => {
            const label = escLine(raw);
            const icon = pickIcon(label, iconFallback);
            return `        - label ${label}\n          icon ${icon}`;
        })
        .join('\n');
}

/**
 * Genera sintaxis AntV Infographic para pasos vs beneficios (plantilla compare-binary).
 * @see https://infographic.antv.vision/learn/infographic-syntax
 */
export function buildAntvInfographicDsl(input: InfographicInput): string {
    const title = escLine(input.title);
    const desc = escLine(input.subtitle ?? 'Generada por AgentZirox');
    const template = input.template?.trim() || DEFAULT_TEMPLATE;
    const steps = childLines(input.steps, 'arrow right');
    const benefits = childLines(input.benefits, 'spark');

    return `infographic ${template}
data
  title ${title}
  desc ${desc}
  compares
    - label Pasos
      icon list check
      children
${steps}
    - label Beneficios
      icon star fill
      children
${benefits}
theme
  palette #8b5cf6 #0ea5e9 #14b8a6 #f97316
  base.text.font-family Inter, system-ui, sans-serif`;
}

/** HTML mínimo para render AntV en headless (Playwright). */
export function buildAntvInfographicHtml(dsl: string, width = 1080, height = 1350): string {
    const dslJson = JSON.stringify(dsl);
    const version = '0.2.16';
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #0b0e1a; }
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
    editable: false,
  });
  window.__INFO_READY__ = false;
  window.__INFO_ERROR__ = null;
  info.on('loaded', function () {
    window.__INFO_READY__ = true;
  });
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
