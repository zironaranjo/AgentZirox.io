import { google } from 'googleapis';

interface ImportantEmail {
    id: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
}

function getGoogleAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/oauth2callback';
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            'Google OAuth no configurado. Define GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN.'
        );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}

const GOOGLE_OAUTH_SCOPE_HINT =
    'Regenera GOOGLE_REFRESH_TOKEN con los scopes del README: `spreadsheets` obligatorio para Sheets; si indicas carpeta en Drive o GOOGLE_DRIVE_ROOT_FOLDER_ID, añade tambien `https://www.googleapis.com/auth/drive.file`.';

function augmentGoogleError(err: unknown): Error {
    if (err instanceof Error) {
        const m = err.message;
        if (/insufficient authentication scopes/i.test(m) || /Insufficient Permission/i.test(m)) {
            return new Error(`${GOOGLE_OAUTH_SCOPE_HINT}\n\nDetalle API: ${m}`);
        }
    }
    return err instanceof Error ? err : new Error(String(err));
}

function sanitizeFileName(input: string): string {
    return input
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

async function listImportantEmails(limit: number): Promise<ImportantEmail[]> {
    const auth = getGoogleAuthClient();
    const gmail = google.gmail({ version: 'v1', auth });

    const listRes = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX', 'IMPORTANT'],
        maxResults: limit,
    });

    const messages = listRes.data.messages ?? [];
    const results: ImportantEmail[] = [];

    for (const msg of messages) {
        if (!msg.id) continue;
        const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const headers = detail.data.payload?.headers ?? [];
        const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '(sin asunto)';
        const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? 'desconocido';
        const date = headers.find((h) => h.name?.toLowerCase() === 'date')?.value ?? '';
        const snippet = detail.data.snippet ?? '';

        results.push({
            id: msg.id,
            subject,
            from,
            date,
            snippet,
        });
    }

    return results;
}

export async function createDriveFolder(name: string, parentFolderId?: string): Promise<{ id: string; name: string }> {
    const auth = getGoogleAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const parent = parentFolderId || rootFolderId;

    const createRes = await drive.files.create({
        requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            ...(parent ? { parents: [parent] } : {}),
        },
        fields: 'id,name',
    });

    if (!createRes.data.id || !createRes.data.name) {
        throw new Error('No se pudo crear la carpeta en Google Drive.');
    }

    return { id: createRes.data.id, name: createRes.data.name };
}

export async function saveImportantEmailsToDrive(folderId: string, limit: number): Promise<{
    total: number;
    files: string[];
}> {
    const auth = getGoogleAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const emails = await listImportantEmails(limit);

    const uploadedFiles: string[] = [];
    for (const email of emails) {
        const fileName = sanitizeFileName(`${email.subject || 'email'}-${email.id}.md`);
        const content = [
            `# ${email.subject}`,
            '',
            `- ID: ${email.id}`,
            `- From: ${email.from}`,
            `- Date: ${email.date}`,
            '',
            '## Snippet',
            email.snippet || '(sin contenido)',
            '',
        ].join('\n');

        await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId],
                mimeType: 'text/markdown',
            },
            media: {
                mimeType: 'text/markdown',
                body: content,
            },
            fields: 'id,name',
        });

        uploadedFiles.push(fileName);
    }

    return { total: uploadedFiles.length, files: uploadedFiles };
}

export async function archiveImportantEmailsByFolderName(
    folderName: string,
    limit: number,
    parentFolderId?: string
): Promise<{ folderId: string; folderName: string; total: number; files: string[] }> {
    const folder = await createDriveFolder(folderName, parentFolderId);
    const saved = await saveImportantEmailsToDrive(folder.id, limit);
    return {
        folderId: folder.id,
        folderName: folder.name,
        total: saved.total,
        files: saved.files,
    };
}

// ── Google Sheets ───────────────────────────────────────────────────────────

/**
 * Crea un Spreadsheet vacío (una pestaña por defecto).
 * Usa Sheets API `spreadsheets.create` (scope `spreadsheets`), no Drive `files.create`,
 * para que funcione con tokens que solo tienen Sheets.
 * Si hay carpeta destino (argumento o GOOGLE_DRIVE_ROOT_FOLDER_ID), mueve el archivo con Drive API (hace falta `drive.file`).
 */
export async function createSpreadsheet(
    title: string,
    parentFolderId?: string
): Promise<{ id: string; name: string; url: string }> {
    const auth = getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const trimmed = title.trim();

    try {
        const createRes = await sheets.spreadsheets.create({
            requestBody: { properties: { title: trimmed } },
        });

        const id = createRes.data.spreadsheetId;
        if (!id) {
            throw new Error('No se pudo crear la hoja de calculo.');
        }

        const name = createRes.data.properties?.title ?? trimmed;
        const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
        const parent = parentFolderId?.trim() || rootFolderId;

        if (parent) {
            try {
                const drive = google.drive({ version: 'v3', auth });
                const meta = await drive.files.get({ fileId: id, fields: 'parents' });
                const prevParents = meta.data.parents?.join(',') ?? '';
                await drive.files.update({
                    fileId: id,
                    addParents: parent,
                    removeParents: prevParents,
                    fields: 'id',
                });
            } catch (moveErr) {
                const moveMsg = moveErr instanceof Error ? moveErr.message : String(moveErr);
                const scopeProblem =
                    /insufficient authentication scopes/i.test(moveMsg) ||
                    /Insufficient Permission/i.test(moveMsg);
                if (!scopeProblem) {
                    throw augmentGoogleError(moveErr);
                }
                // Hoja ya creada en la raiz de Drive; falta drive.file (o reautorizar) para moverla.
            }
        }

        const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
        return { id, name, url };
    } catch (e) {
        throw augmentGoogleError(e);
    }
}

/** Titulo de la primera pestaña (para rangos A1 justo tras crear un documento). */
export async function getFirstSheetTitle(spreadsheetId: string): Promise<string> {
    const auth = getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
    });
    const t = res.data.sheets?.[0]?.properties?.title;
    if (!t) throw new Error('No se encontro ninguna pestaña en el spreadsheet');
    return t;
}

export async function sheetsGetValues(spreadsheetId: string, rangeA1: string): Promise<string[][]> {
    const auth = getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: rangeA1,
    });
    return (res.data.values as string[][]) ?? [];
}

export async function sheetsUpdateValues(
    spreadsheetId: string,
    rangeA1: string,
    values: string[][]
): Promise<{ updatedRows: number; updatedColumns: number; updatedCells: number }> {
    const auth = getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: rangeA1,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });
    const updated = res.data.updatedRows ?? 0;
    const cols = res.data.updatedColumns ?? 0;
    const cells = res.data.updatedCells ?? 0;
    return { updatedRows: updated, updatedColumns: cols, updatedCells: cells };
}

// ── Google Calendar ─────────────────────────────────────────────────────────

export interface CalendarEventBrief {
    id: string;
    summary: string;
    start?: string;
    end?: string;
    htmlLink?: string;
}

export async function calendarListEvents(
    timeMinIso: string,
    timeMaxIso: string,
    maxResults: number,
    calendarId = 'primary'
): Promise<CalendarEventBrief[]> {
    const auth = getGoogleAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.list({
        calendarId,
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        maxResults: Math.min(Math.max(maxResults, 1), 100),
        singleEvents: true,
        orderBy: 'startTime',
    });

    const items = res.data.items ?? [];
    return items
        .filter((e) => e.id)
        .map((e) => ({
            id: e.id!,
            summary: e.summary ?? '(sin título)',
            start: (e.start?.dateTime ?? e.start?.date) ?? undefined,
            end: (e.end?.dateTime ?? e.end?.date) ?? undefined,
            htmlLink: e.htmlLink ?? undefined,
        }));
}

export async function calendarCreateEvent(
    calendarId: string,
    summary: string,
    startIso: string,
    endIso: string,
    description?: string
): Promise<{ id: string; htmlLink?: string }> {
    const auth = getGoogleAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.insert({
        calendarId,
        requestBody: {
            summary,
            description: description?.trim() || undefined,
            start: { dateTime: startIso },
            end: { dateTime: endIso },
        },
    });
    if (!res.data.id) throw new Error('Calendar API no devolvió id del evento');
    return { id: res.data.id, htmlLink: res.data.htmlLink ?? undefined };
}
