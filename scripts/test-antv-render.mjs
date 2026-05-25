import { buildAntvInfographicDsl, buildAntvInfographicHtml } from '../src/lib/antv-infographic-dsl.ts';
import { writeFileSync } from 'fs';

const dsl = buildAntvInfographicDsl({
  title: 'AgentZirox recuerda tus tareas',
  subtitle: 'Memoria + n8n + Telegram',
  steps: ['Pide al agente por Telegram', 'n8n guarda en Postgres', 'Te avisa a la hora'],
  benefits: ['Sin olvidar pendientes', 'IDs reales, sin alucinar', 'Obsidian sincronizado'],
});

console.log('DSL:\n', dsl.slice(0, 400), '...\n');

const html = buildAntvInfographicHtml(dsl);
writeFileSync('.tmp-antv-test.html', html);

const { renderInfographicHtmlToPng } = await import('../src/lib/infographic-render.ts');
const png = await renderInfographicHtmlToPng(html);
writeFileSync('.tmp-antv-test.png', png);
console.log('OK PNG', png.length, 'bytes → .tmp-antv-test.png');
