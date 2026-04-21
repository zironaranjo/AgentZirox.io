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
