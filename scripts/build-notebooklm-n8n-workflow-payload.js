// Run: node scripts/build-notebooklm-n8n-workflow-payload.js > .tmp-n8n-notebooklm.json
const normCode = `const raw=$input.first().json;const b=raw.body&&typeof raw.body==='object'?raw.body:raw;
const arr=v=>Array.isArray(v)?v.map(String).filter(Boolean):typeof v==='string'&&v.trim()?v.split(/\\n+/).map(s=>s.trim()).filter(Boolean):[];
const title=String(b.title||'').trim()||String(b.brief||'Infografia NotebookLM').slice(0,80);
return [{json:{chat_id:String(b.chat_id||'global'),title,subtitle:String(b.subtitle||'NotebookLM · AgentZirox'),brief:String(b.brief||''),steps:arr(b.steps).slice(0,8),benefits:arr(b.benefits).slice(0,8),sources:arr(b.sources).slice(0,8),slug:String(b.slug||title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,48)),provider:'notebooklm'}}];`;

const buildCode = `const d=$('Normalizar Entrada').first().json;
const steps=d.steps.map((s,i)=>(i+1)+'. '+s).join('\\n');
const benefits=d.benefits.map(b=>'- '+b).join('\\n');
const src=d.sources.length?('\\n\\n## Fuentes\\n'+d.sources.map(u=>'- '+u).join('\\n')):'';
const guion='# Infografia NotebookLM: '+d.title+'\\n\\n## '+d.subtitle+'\\n\\n'+(d.brief?d.brief+'\\n\\n':'')+'## Pasos\\n'+steps+'\\n\\n## Beneficios\\n'+benefits+src;
return [{json:{...d,guion_md:guion,design_url:'notebooklm',status:'generating'}}];`;

const respCode = `const gen=$('Generar Guion').first().json;const id=$input.first().json.id||$('Guardar Job').first().json.id;
return [{json:{success:true,action:'create_infographic_notebooklm',job_id:id,title:gen.title,slug:gen.slug,guion_md:gen.guion_md,guion_preview:(gen.guion_md||'').slice(0,800),provider:'notebooklm',message:'Job NotebookLM #'+id+' — generación en agente'}}];`;

const wf = {
  name: 'zirox_2026 | Infografia NotebookLM',
  settings: { executionOrder: 'v1', timezone: 'Europe/Madrid', availableInMCP: true },
  nodes: [
    {
      id: 'wh-nlm',
      name: 'Webhook NotebookLM',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2.1,
      position: [-1200, 0],
      webhookId: 'zirox-agent-infografia-notebooklm-2026',
      parameters: { httpMethod: 'POST', path: 'agent-infografia-notebooklm', responseMode: 'responseNode', options: {} },
    },
    { id: 'code-norm', name: 'Normalizar Entrada', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-960, 0], parameters: { jsCode: normCode } },
    {
      id: 'pg-init',
      name: 'Asegurar Tabla',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-720, 0],
      credentials: { postgres: { id: '640RC2DVmYMPdJuN', name: 'Supabase_vps' } },
      parameters: {
        operation: 'executeQuery',
        query:
          "CREATE TABLE IF NOT EXISTS public.infographic_jobs (id BIGSERIAL PRIMARY KEY, chat_id TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT, slug TEXT, guion_md TEXT, html_content TEXT, design_url TEXT, png_url TEXT, status TEXT NOT NULL DEFAULT 'ready', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); ALTER TABLE public.infographic_jobs ADD COLUMN IF NOT EXISTS provider TEXT;",
        options: {},
      },
    },
    { id: 'code-build', name: 'Generar Guion', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-480, 0], parameters: { jsCode: buildCode } },
    {
      id: 'pg-insert',
      name: 'Guardar Job',
      type: 'n8n-nodes-base.postgres',
      typeVersion: 2.6,
      position: [-240, 0],
      credentials: { postgres: { id: '640RC2DVmYMPdJuN', name: 'Supabase_vps' } },
      parameters: {
        operation: 'insert',
        schema: { __rl: true, mode: 'list', value: 'public' },
        table: { __rl: true, mode: 'list', value: 'infographic_jobs' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            chat_id: "={{ $('Generar Guion').item.json.chat_id }}",
            title: "={{ $('Generar Guion').item.json.title }}",
            subtitle: "={{ $('Generar Guion').item.json.subtitle }}",
            slug: "={{ $('Generar Guion').item.json.slug }}",
            guion_md: "={{ $('Generar Guion').item.json.guion_md }}",
            html_content: 'notebooklm',
            design_url: "={{ $('Generar Guion').item.json.design_url }}",
            status: "={{ $('Generar Guion').item.json.status }}",
          },
        },
        options: {},
      },
    },
    { id: 'code-resp', name: 'Respuesta Final', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: respCode } },
    { id: 'resp-wh', name: 'Responder Webhook', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.5, position: [240, 0], parameters: { respondWith: 'json', responseBody: '={{ $json }}' } },
  ],
  connections: {
    'Webhook NotebookLM': { main: [[{ node: 'Normalizar Entrada', type: 'main', index: 0 }]] },
    'Normalizar Entrada': { main: [[{ node: 'Asegurar Tabla', type: 'main', index: 0 }]] },
    'Asegurar Tabla': { main: [[{ node: 'Generar Guion', type: 'main', index: 0 }]] },
    'Generar Guion': { main: [[{ node: 'Guardar Job', type: 'main', index: 0 }]] },
    'Guardar Job': { main: [[{ node: 'Respuesta Final', type: 'main', index: 0 }]] },
    'Respuesta Final': { main: [[{ node: 'Responder Webhook', type: 'main', index: 0 }]] },
  },
};
process.stdout.write(JSON.stringify(wf));
