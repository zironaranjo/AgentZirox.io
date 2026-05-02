import { registerTool } from '../core/dispatcher';
import {
    calendarCreateEvent,
    calendarListEvents,
    createSpreadsheet,
    getFirstSheetTitle,
    sheetsGetValues,
    sheetsUpdateValues,
} from '../integrations/google/google';

registerTool({
    name: 'google_sheets_quick_note',
    description:
        'Crear un Google Spreadsheet nuevo y guardar UNA nota en texto libre. Usar cuando pidan crear hoja/Sheets en Drive con titulo (document_title) y un texto a guardar, o "crea notas y escribe...", "primera linea asi: ...". No usar para posts de LinkedIn ni marketing si el usuario hablo de Sheets.',
    parameters: {
        type: 'object',
        properties: {
            note_text: {
                type: 'string',
                description: 'Texto completo de la nota tal como debe quedar guardada',
            },
            document_title: {
                type: 'string',
                description:
                    'Titulo del archivo en Drive (opcional). Ej. Notas personales, Ideas Zirox. Si vacio se usa "Nota rapida" + fecha Madrid.',
            },
        },
        required: ['note_text'],
    },
    handler: async (args) => {
        const { note_text, document_title } = args as { note_text: string; document_title?: string };
        const text = note_text.trim();
        if (!text) throw new Error('note_text vacio');

        const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        const title =
            (document_title?.trim() || `Nota rapida ${dateStr}`).slice(0, 120);

        const doc = await createSpreadsheet(title);
        const tab = await getFirstSheetTitle(doc.id);
        const tabQ = /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`;
        const range = `${tabQ}!A1:A2`;

        const created = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
        await sheetsUpdateValues(doc.id, range, [[text], [`Registrado: ${created}`]]);

        return [
            '✅ Hoja creada con tu nota.',
            `📛 ${doc.name}`,
            `🆔 ID: \`${doc.id}\``,
            `🔗 ${doc.url}`,
        ].join('\n');
    },
});

registerTool({
    name: 'google_sheets_create',
    description:
        'Crear un nuevo Google Spreadsheet vacio (titulo libre). Opcionalmente dentro de una carpeta Drive (parent_folder_id). Devuelve id y enlace para abrirlo.',
    parameters: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Nombre del documento, ej. Notas Zirox 2026' },
            parent_folder_id: {
                type: 'string',
                description: 'ID de carpeta en Drive (opcional). Si vacio, usa GOOGLE_DRIVE_ROOT_FOLDER_ID o la raiz de Drive',
            },
        },
        required: ['title'],
    },
    handler: async (args) => {
        const { title, parent_folder_id } = args as { title: string; parent_folder_id?: string };
        const parent = parent_folder_id?.trim() || undefined;
        const doc = await createSpreadsheet(title, parent);
        return [
            '✅ Hoja creada.',
            `📛 Nombre: ${doc.name}`,
            `🆔 ID (para read/write): \`${doc.id}\``,
            `🔗 ${doc.url}`,
            '',
            'La primera pestaña suele llamarse "Hoja 1". Para escribir cabeceras: rango `Hoja 1!A1:C1` o renombra la pestaña en Sheets.',
        ].join('\n');
    },
});

registerTool({
    name: 'google_sheets_read',
    description:
        'Leer celdas de una hoja de calculo de Google Sheets. spreadsheet_id es el ID de la URL (entre /d/ y /edit). range en notacion A1 ej. "Hoja1!A1:D20".',
    parameters: {
        type: 'object',
        properties: {
            spreadsheet_id: { type: 'string', description: 'ID del documento Sheets' },
            range: { type: 'string', description: 'Rango A1, ej. Sheet1!A1:C10' },
        },
        required: ['spreadsheet_id', 'range'],
    },
    handler: async (args) => {
        const { spreadsheet_id, range } = args as { spreadsheet_id: string; range: string };
        const rows = await sheetsGetValues(spreadsheet_id.trim(), range.trim());
        if (rows.length === 0) return '📄 Rango vacio o sin datos.';
        const lines = rows.map((r) => r.join('\t')).join('\n');
        return `📊 Valores (${rows.length} filas):\n\n${lines}`;
    },
});

registerTool({
    name: 'google_sheets_write',
    description:
        'Escribir valores en Google Sheets (sobrescribe el rango indicado). values_json debe ser un JSON de array de filas, cada fila array de celdas, ej. [["Nombre","Edad"],["Ana","30"]]',
    parameters: {
        type: 'object',
        properties: {
            spreadsheet_id: { type: 'string', description: 'ID del documento Sheets' },
            range: { type: 'string', description: 'Esquina superior izquierda o rango, ej. Hoja1!A1' },
            values_json: { type: 'string', description: 'JSON: [["col1","col2"],["a","b"]]' },
        },
        required: ['spreadsheet_id', 'range', 'values_json'],
    },
    handler: async (args) => {
        const { spreadsheet_id, range, values_json } = args as {
            spreadsheet_id: string;
            range: string;
            values_json: string;
        };
        let values: string[][];
        try {
            const parsed = JSON.parse(values_json) as unknown;
            if (!Array.isArray(parsed)) throw new Error('values_json debe ser un array');
            values = parsed.map((row) => {
                if (!Array.isArray(row)) throw new Error('cada fila debe ser un array');
                return row.map((c) => (c === null || c === undefined ? '' : String(c)));
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`values_json invalido: ${msg}`);
        }
        const r = await sheetsUpdateValues(spreadsheet_id.trim(), range.trim(), values);
        return `✅ Sheets actualizado: ${r.updatedCells} celdas (${r.updatedRows}x${r.updatedColumns}).`;
    },
});

registerTool({
    name: 'google_calendar_list_events',
    description:
        'Listar eventos del calendario de Google entre dos instantes (ISO 8601). Por defecto calendario "primary".',
    parameters: {
        type: 'object',
        properties: {
            time_min_iso: {
                type: 'string',
                description: 'Inicio del intervalo, RFC3339 ej. 2026-04-24T00:00:00+02:00',
            },
            time_max_iso: {
                type: 'string',
                description: 'Fin del intervalo, RFC3339 ej. 2026-04-25T23:59:59+02:00',
            },
            max_results: { type: 'string', description: 'Max eventos (default 20, max 100)' },
            calendar_id: { type: 'string', description: 'ID calendario, default primary' },
        },
        required: ['time_min_iso', 'time_max_iso'],
    },
    handler: async (args) => {
        const { time_min_iso, time_max_iso, max_results, calendar_id } = args as {
            time_min_iso: string;
            time_max_iso: string;
            max_results?: string;
            calendar_id?: string;
        };
        const max = max_results ? Number(max_results) : 20;
        const events = await calendarListEvents(
            time_min_iso.trim(),
            time_max_iso.trim(),
            max,
            calendar_id?.trim() || 'primary'
        );
        if (events.length === 0) return '📅 No hay eventos en ese intervalo.';
        const lines = events.map(
            (e, i) =>
                `${i + 1}. **${e.summary}** (${e.start ?? '?'} → ${e.end ?? '?'})\n   id: \`${e.id}\`${e.htmlLink ? `\n   ${e.htmlLink}` : ''}`
        );
        return `📅 Eventos (${events.length}):\n\n${lines.join('\n\n')}`;
    },
});

registerTool({
    name: 'google_calendar_create_event',
    description: 'Crear un evento en Google Calendar (horario con fecha y hora, ISO 8601 con zona).',
    parameters: {
        type: 'object',
        properties: {
            summary: { type: 'string', description: 'Titulo del evento' },
            start_iso: { type: 'string', description: 'Inicio RFC3339 ej. 2026-04-25T10:00:00+02:00' },
            end_iso: { type: 'string', description: 'Fin RFC3339 ej. 2026-04-25T11:00:00+02:00' },
            description: { type: 'string', description: 'Notas opcionales' },
            calendar_id: { type: 'string', description: 'default primary' },
        },
        required: ['summary', 'start_iso', 'end_iso'],
    },
    handler: async (args) => {
        const { summary, start_iso, end_iso, description, calendar_id } = args as {
            summary: string;
            start_iso: string;
            end_iso: string;
            description?: string;
            calendar_id?: string;
        };
        const ev = await calendarCreateEvent(
            calendar_id?.trim() || 'primary',
            summary.trim(),
            start_iso.trim(),
            end_iso.trim(),
            description
        );
        return [`✅ Evento creado`, `id: ${ev.id}`, ev.htmlLink ? `🔗 ${ev.htmlLink}` : ''].filter(Boolean).join('\n');
    },
});
