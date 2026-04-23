#!/usr/bin/env node
/**
 * Dispara manualmente /api/cron/scheduled-tasks (misma petición que Dokploy).
 *
 * Uso desde la raíz del repo:
 *   node scripts/ping-scheduled-cron.mjs
 *
 * Variables (o en .env con dotenv):
 *   PUBLIC_APP_URL   — base, ej. https://ziro.zirox.io (sin barra final)
 *   CRON_SECRET      — o SELF_IMPROVE_CRON_SECRET
 */
import 'dotenv/config';

const base = (process.env.PUBLIC_APP_URL ?? 'https://ziro.zirox.io').replace(/\/$/, '');
const secret = (process.env.CRON_SECRET ?? process.env.SELF_IMPROVE_CRON_SECRET ?? '').trim();
const url = `${base}/api/cron/scheduled-tasks`;

if (!secret) {
    console.error('Falta CRON_SECRET o SELF_IMPROVE_CRON_SECRET en el entorno o .env');
    process.exit(1);
}

const res = await fetch(url, {
    headers: {
        Authorization: `Bearer ${secret}`,
    },
});

const text = await res.text();
console.log(res.status, text);
