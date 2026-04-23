import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initMemory } from '../core/memory';
import { executeTool } from '../core/dispatcher';
import { processMessage } from '../core/agent';

// Bootstrap all tools
import '../tools/index';

async function main() {
    await initMemory();

    const server = new McpServer({
        name: 'AgenteZirox',
        version: process.env.AGENT_VERSION ?? '1.0.0',
    });

    // ── Tool: chat ────────────────────────────────────────────────────────────
    server.tool(
        'chat',
        'Send a message to AgenteZirox and receive an AI response',
        {
            message: z.string().describe('The message or command to send to the agent'),
            chat_id: z.string().optional().describe('Chat session ID (default: "mcp-default")'),
        },
        async ({ message, chat_id }) => {
            const session = chat_id ?? 'mcp-default';
            const response = await processMessage(session, message);
            return { content: [{ type: 'text', text: response }] };
        }
    );

    // ── Tool: send_email ──────────────────────────────────────────────────────
    server.tool(
        'send_email',
        'Send an email via AgenteZirox SMTP integration',
        {
            to: z.string().describe('Recipient email address'),
            subject: z.string().describe('Email subject'),
            body: z.string().describe('Email body content'),
        },
        async (args) => {
            const result = await executeTool('send_email', args);
            return { content: [{ type: 'text', text: result }] };
        }
    );

    // ── Tool: call_api ────────────────────────────────────────────────────────
    server.tool(
        'call_api',
        'Make an HTTP request to any REST API endpoint',
        {
            method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
            url: z.string().url().describe('Full URL to call'),
            headers: z.string().optional().describe('JSON string of headers'),
            body: z.string().optional().describe('JSON string of request body'),
        },
        async (args) => {
            const result = await executeTool('call_api', args);
            return { content: [{ type: 'text', text: result }] };
        }
    );

    // ── Start server ──────────────────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('🔌 AgenteZirox MCP Server running via stdio');
}

main().catch((err) => {
    console.error('❌ MCP Server error:', err);
    process.exit(1);
});
