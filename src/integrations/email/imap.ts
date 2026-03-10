import { ImapFlow } from 'imapflow';
import { logger } from '../../core/logger.js';

export interface EmailMessage {
    uid: number;
    subject: string;
    from: string;
    date: string;
    body: string;
}

/**
 * Read the most recent N emails from the inbox
 */
export async function readInbox(limit = 10): Promise<EmailMessage[]> {
    if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASS) {
        throw new Error('IMAP not configured. Set IMAP_HOST, IMAP_USER, IMAP_PASS in .env');
    }

    const client = new ImapFlow({
        host: process.env.IMAP_HOST,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: true,
        auth: {
            user: process.env.IMAP_USER,
            pass: process.env.IMAP_PASS,
        },
        logger: false,
    });

    const messages: EmailMessage[] = [];

    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');

        try {
            const mailbox = client.mailbox;
            const total = (mailbox as { exists?: number }).exists ?? 0;
            const start = Math.max(1, total - limit + 1);
            const range = `${start}:${total}`;

            for await (const msg of client.fetch(range, {
                uid: true,
                envelope: true,
                bodyStructure: true,
                source: true,
            })) {
                const envelope = msg.envelope;
                try {
                    const source = msg.source.toString('utf-8');
                    // Extract plain text body (basic extraction)
                    const bodyMatch = source.match(/\r\n\r\n([\s\S]+?)(\r\n--|\s*$)/);
                    const body = bodyMatch ? bodyMatch[1].trim() : '(no body)';
                    messages.push({
                        uid: msg.uid,
                        subject: envelope.subject ?? '(no subject)',
                        from: envelope.from?.[0]?.address ?? 'unknown',
                        date: envelope.date?.toISOString() ?? '',
                        body: body.substring(0, 500),
                    });
                } catch {
                    // skip malformed messages
                }
            }
        } finally {
            lock.release();
        }

        await client.logout();
    } catch (err) {
        logger.error('IMAP error:', err);
        throw err;
    }

    return messages.reverse(); // newest first
}
