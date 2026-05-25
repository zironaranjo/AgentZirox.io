import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const apiKey =
  process.env.N8N_API_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMWIyNzU2ZS1mMjk5LTQ4OGUtOWY0Ny05ZWQ4YzMwMzdiZTciLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzc5NTcwMjk0fQ.yqNJ2s4J2KK9V1LoTSf0ZqTBudC_0HLXi2VZaBkrf0s';
const base = 'https://ziroxxn8n.ziroxn8n.site/api/v1';
const headers = { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' };

const { execSync } = await import('child_process');
const wfJson = execSync('node scripts/build-notebooklm-n8n-workflow-payload.js', {
  cwd: root,
  encoding: 'utf8',
});
const wf = JSON.parse(wfJson);

const listRes = await fetch(`${base}/workflows?limit=100`, { headers });
const list = await listRes.json();
const existing = (list.data || []).find((w) => w.name === wf.name);

let id = existing?.id;
if (id) {
  console.log('Updating workflow', id);
  const putRes = await fetch(`${base}/workflows/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const putBody = await putRes.text();
  if (!putRes.ok) {
    console.error('PUT failed', putRes.status, putBody.slice(0, 500));
    process.exit(1);
  }
} else {
  console.log('Creating workflow');
  const postRes = await fetch(`${base}/workflows`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }),
  });
  const postBody = await postRes.text();
  if (!postRes.ok) {
    console.error('POST failed', postRes.status, postBody.slice(0, 500));
    process.exit(1);
  }
  id = JSON.parse(postBody).id;
  console.log('Created', id);
}

const actRes = await fetch(`${base}/workflows/${id}/activate`, { method: 'POST', headers });
const actBody = await actRes.text();
if (!actRes.ok) {
  console.error('Activate failed', actRes.status, actBody.slice(0, 300));
  process.exit(1);
}
console.log('Activated', id);

const test = await fetch('https://ziroxxn8n.ziroxn8n.site/webhook/agent-infografia-notebooklm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Test NotebookLM AgentZirox',
    subtitle: 'Prueba automática',
    steps: ['Pide al agente', 'NotebookLM genera', 'PNG en Telegram'],
    benefits: ['Calidad editorial', 'Fuentes web', 'Obsidian'],
    chat_id: 'test-cursor',
  }),
});
const testText = await test.text();
console.log('Webhook', test.status, testText.slice(0, 400));
