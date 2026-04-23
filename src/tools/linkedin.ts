import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerTool } from '../core/dispatcher';
import { getWorkspaceBaseDir, resolveSafeWorkspacePath } from './workspace-utils';

const DRAFTS_DIR = 'linkedin/drafts';

function slugify(input: string, maxLen: number): string {
    const s = input
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen);
    return s || 'borrador';
}

registerTool({
    name: 'linkedin_save_draft',
    description:
        'Guardar un borrador de LinkedIn en el workspace (markdown en linkedin/drafts/). Usar cuando el usuario quiera guardar un post, titular, resumen Acerca de, comentario o mensaje de conexion para revisarlo o publicarlo manualmente en LinkedIn.',
    parameters: {
        type: 'object',
        properties: {
            kind: {
                type: 'string',
                enum: ['post', 'headline', 'about', 'comment', 'connection_message', 'other'],
                description:
                    'Tipo de contenido: post (publicacion), headline (titular), about (seccion Acerca de), comment, connection_message (invitacion), other',
            },
            body: {
                type: 'string',
                description: 'Texto del borrador tal como debe quedar (puede incluir parrafos; el agente ya lo habra pulido si hace falta)',
            },
            title_hint: {
                type: 'string',
                description:
                    'Etiqueta corta opcional para el nombre del archivo, ej. lanzamiento-producto, reflexion-liderazgo',
            },
            context: {
                type: 'string',
                description:
                    'Notas opcionales: publico objetivo, tono, hashtags sugeridos, etc. (se guardan al final del archivo)',
            },
        },
        required: ['kind', 'body'],
    },
    handler: async (args) => {
        const { kind, body, title_hint, context } = args as {
            kind: string;
            body: string;
            title_hint?: string;
            context?: string;
        };

        const text = body.trim();
        if (!text) {
            throw new Error('body vacio');
        }

        const now = new Date();
        const fecha = now.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        const fechaArchivo = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        const hora = now.toLocaleTimeString('sv-SE', {
            timeZone: 'Europe/Madrid',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });

        const slug = slugify(title_hint?.trim() || text.replace(/\n/g, ' '), 48);
        const relativePath = path.posix.join(DRAFTS_DIR, `${fechaArchivo}_${hora.replace(/:/g, '')}_${kind}_${slug}.md`);
        const target = resolveSafeWorkspacePath(relativePath);
        await mkdir(path.dirname(target), { recursive: true });

        const front = [
            '---',
            `kind: ${kind}`,
            `created_madrid: ${fecha}`,
            'source: agentezirox',
            '---',
            '',
        ].join('\n');

        const tail =
            context?.trim() ?
                ['', '## Contexto / notas', '', context.trim(), ''].join('\n')
            :   '';

        await writeFile(target, `${front}${text}${tail}`, 'utf8');

        return [
            '✅ Borrador de LinkedIn guardado en el workspace.',
            `📁 Base: ${getWorkspaceBaseDir()}`,
            `📄 ${relativePath}`,
            '',
            'Puedes abrir el archivo en el VPS o pedir read_file con esa ruta. Para publicar en LinkedIn, copia el texto desde el archivo (LinkedIn no esta conectado por API en este agente).',
        ].join('\n');
    },
});

registerTool({
    name: 'linkedin_list_drafts',
    description:
        'Listar borradores de LinkedIn guardados en linkedin/drafts/ (mas recientes primero). Usar cuando el usuario pregunte que borradores tiene o quiera revisar los ultimos.',
    parameters: {
        type: 'object',
        properties: {
            limit: {
                type: 'string',
                description: 'Maximo de archivos a mostrar (por defecto 15)',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const raw = (args as { limit?: string }).limit;
        const limit = Math.min(50, Math.max(1, parseInt(raw ?? '15', 10) || 15));

        const dir = resolveSafeWorkspacePath(DRAFTS_DIR);
        let names: string[];
        try {
            names = await readdir(dir);
        } catch {
            return [
                'Todavia no hay borradores en linkedin/drafts/.',
                'Pide al agente que redacte algo para LinkedIn y use linkedin_save_draft para guardarlo.',
            ].join('\n');
        }

        const mdFiles = names.filter((n) => n.endsWith('.md'));
        const withStat = await Promise.all(
            mdFiles.map(async (name) => {
                const full = path.join(dir, name);
                const st = await stat(full);
                return { name, mtime: st.mtimeMs };
            })
        );

        withStat.sort((a, b) => b.mtime - a.mtime);
        const slice = withStat.slice(0, limit);

        if (slice.length === 0) {
            return 'La carpeta linkedin/drafts/ existe pero no hay archivos .md.';
        }

        const lines = slice.map(
            (s, i) => `${i + 1}. \`${path.posix.join(DRAFTS_DIR, s.name)}\` (${new Date(s.mtime).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })})`
        );

        return ['📋 Borradores LinkedIn (mas recientes primero):', '', ...lines].join('\n');
    },
});
