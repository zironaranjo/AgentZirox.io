import { buildAntvInfographicDsl, buildAntvInfographicHtml, coerceInfographicItems } from '../src/lib/antv-infographic-dsl.ts';
import { writeFileSync } from 'fs';

const steps = coerceInfographicItems([
  { label: 'Captura inmediata por Telegram' },
  { text: 'Prioriza por urgencia' },
  'Revisa y actualiza cada día',
]);
const benefits = coerceInfographicItems([
  'Menos estrés',
  'Más productividad',
  'Cumples objetivos',
]);

console.log('steps', steps);
const dsl = buildAntvInfographicDsl({
  title: 'Domina tu Productividad',
  subtitle: 'Gestión inteligente de tareas',
  steps,
  benefits,
});
console.log(dsl);
writeFileSync('.tmp-antv-test.html', buildAntvInfographicHtml(dsl));

const { renderAntvInfographicToPng } = await import('../src/lib/infographic-render.ts');
const png = await renderAntvInfographicToPng(dsl);
writeFileSync('.tmp-antv-test.png', png);
console.log('OK', png.length, 'bytes');
