// Run: node scripts/build-infografia-workflow-payload.js > .tmp-n8n-infografia-compact.json
const normCode = `const raw=$input.first().json;const b=raw.body&&typeof raw.body==='object'?raw.body:raw;
const arr=v=>Array.isArray(v)?v.map(String).filter(Boolean):typeof v==='string'&&v.trim()?v.split(/\\n+/).map(s=>s.trim()).filter(Boolean):[];
const title=String(b.title||'').trim()||String(b.brief||'Infografia').slice(0,80);
return [{json:{chat_id:String(b.chat_id||'global'),title,subtitle:String(b.subtitle||'Generada por AgentZirox'),steps:arr(b.steps).slice(0,8),benefits:arr(b.benefits).slice(0,8),template:String(b.template||'').trim(),example_input:String(b.example_input||''),example_output:String(b.example_output||''),slug:title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,48)}}];`;

const buildCode = `const d=$('Normalizar Entrada').first().json;
const esc=s=>String(s).replace(/\\s+/g,' ').trim();
const steps=d.steps.map((s,i)=>(i+1)+'. '+s).join('\\n');
const benefits=d.benefits.map(b=>'- '+b).join('\\n');
const guion='# Infografia: '+d.title+'\\n\\n## '+d.subtitle+'\\n\\n## Pasos\\n'+steps+'\\n\\n## Beneficios\\n'+benefits;
const child=(items,icon)=>items.slice(0,8).map(s=>'        - label '+esc(s)+'\\n          icon '+icon).join('\\n');
const tpl=d.template||'compare-binary-horizontal-simple-fold';
const antv_dsl='infographic '+tpl+'\\ndata\\n  title '+esc(d.title)+'\\n  desc '+esc(d.subtitle)+'\\n  compares\\n    - label Pasos\\n      icon list check\\n      children\\n'+child(d.steps,'arrow right')+'\\n    - label Beneficios\\n      icon star fill\\n      children\\n'+child(d.benefits,'spark')+'\\ntheme\\n  palette #8b5cf6 #0ea5e9 #14b8a6 #f97316';
return [{json:{...d,guion_md:guion,antv_dsl,html_content:antv_dsl}}];`;

const respCode = `const gen=$('Generar Guion y AntV DSL').first().json;const id=$input.first().json.id||$('Guardar Job').first().json.id;
return [{json:{success:true,action:'create_infographic',job_id:id,title:gen.title,slug:gen.slug,guion_md:gen.guion_md,antv_dsl:gen.antv_dsl,guion_preview:(gen.guion_md||'').slice(0,800),message:'Infografia #'+id+' — AntV DSL listo'}}];`;

const wf = {
  name: 'zirox_2026 | Crear Infografia',
  settings: { executionOrder: 'v1', timezone: 'Europe/Madrid', availableInMCP: true },
  nodes: [
    { id: 'wh-inf', name: 'Webhook Crear Infografia', type: 'n8n-nodes-base.webhook', typeVersion: 2.1, position: [-1200, 0], webhookId: 'zirox-agent-crear-infografia-2026', parameters: { httpMethod: 'POST', path: 'agent-crear-infografia', responseMode: 'responseNode', options: {} } },
    { id: 'code-norm', name: 'Normalizar Entrada', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-960, 0], parameters: { jsCode: normCode } },
    { id: 'pg-init', name: 'Asegurar Tabla', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-720, 0], credentials: { postgres: { id: '640RC2DVmYMPdJuN', name: 'Supabase_vps' } }, parameters: { operation: 'executeQuery', query: "CREATE TABLE IF NOT EXISTS public.infographic_jobs (id BIGSERIAL PRIMARY KEY, chat_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, slug TEXT, guion_md TEXT, html_content TEXT, design_url TEXT, png_url TEXT, status TEXT NOT NULL DEFAULT 'ready', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());", options: {} } },
    { id: 'code-build', name: 'Generar Guion y AntV DSL', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-480, 0], parameters: { jsCode: buildCode } },
    { id: 'pg-insert', name: 'Guardar Job', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-240, 0], credentials: { postgres: { id: '640RC2DVmYMPdJuN', name: 'Supabase_vps' } }, parameters: { operation: 'insert', schema: { __rl: true, mode: 'list', value: 'public' }, table: { __rl: true, mode: 'list', value: 'infographic_jobs' }, columns: { mappingMode: 'defineBelow', value: { chat_id: "={{ $('Generar Guion y AntV DSL').item.json.chat_id }}", title: "={{ $('Generar Guion y AntV DSL').item.json.title }}", subtitle: "={{ $('Generar Guion y AntV DSL').item.json.subtitle }}", slug: "={{ $('Generar Guion y AntV DSL').item.json.slug }}", guion_md: "={{ $('Generar Guion y AntV DSL').item.json.guion_md }}", html_content: "={{ $('Generar Guion y AntV DSL').item.json.antv_dsl }}", status: 'ready' } }, options: {} } },
    { id: 'code-resp', name: 'Respuesta Final', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: respCode } },
    { id: 'resp-wh', name: 'Responder Webhook', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [240, 0], parameters: { respondWith: 'json', responseBody: '={{ $json }}' } },
  ],
  connections: {
    'Webhook Crear Infografia': { main: [[{ node: 'Normalizar Entrada', type: 'main', index: 0 }]] },
    'Normalizar Entrada': { main: [[{ node: 'Asegurar Tabla', type: 'main', index: 0 }]] },
    'Asegurar Tabla': { main: [[{ node: 'Generar Guion y AntV DSL', type: 'main', index: 0 }]] },
    'Generar Guion y AntV DSL': { main: [[{ node: 'Guardar Job', type: 'main', index: 0 }]] },
    'Guardar Job': { main: [[{ node: 'Respuesta Final', type: 'main', index: 0 }]] },
    'Respuesta Final': { main: [[{ node: 'Responder Webhook', type: 'main', index: 0 }]] },
  },
};
process.stdout.write(JSON.stringify(wf));
