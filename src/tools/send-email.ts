import nodemailer from 'nodemailer';
import { registerTool } from '../core/dispatcher';

registerTool({
    name: 'send_email',
    description: 'Send an email to a recipient. Use this when the user asks to send an email.',
    parameters: {
        type: 'object',
        properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Email body content (plain text or HTML)' },
        },
        required: ['to', 'subject', 'body'],
    },
    handler: async (args) => {
        const { to, subject, body } = args as { to: string; subject: string; body: string };

        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            return '❌ Email not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env';
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
            to,
            subject,
            text: body,
            html: body.includes('<') ? body : `<p>${body.replace(/\n/g, '<br>')}</p>`,
        });

        return `✅ Email sent to ${to}. Message ID: ${info.messageId}`;
    },
});
