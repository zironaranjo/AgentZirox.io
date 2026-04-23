import { registerTool } from '../core/dispatcher';

registerTool({
    name: 'call_api',
    description:
        'Make an HTTP request to any REST API. Use when the user asks to interact with external services, get data from a URL, or call a webhook.',
    parameters: {
        type: 'object',
        properties: {
            method: {
                type: 'string',
                description: 'HTTP method',
                enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            },
            url: { type: 'string', description: 'Full URL to call, including query params if needed' },
            headers: {
                type: 'string',
                description: 'JSON string of request headers (optional). Example: {"Authorization":"Bearer token"}',
            },
            body: {
                type: 'string',
                description: 'JSON string of request body (optional, for POST/PUT/PATCH)',
            },
        },
        required: ['method', 'url'],
    },
    handler: async (args) => {
        const { method, url, headers: headersStr, body: bodyStr } = args as {
            method: string;
            url: string;
            headers?: string;
            body?: string;
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (headersStr) {
            Object.assign(headers, JSON.parse(headersStr));
        }

        const options: RequestInit = {
            method,
            headers,
        };
        if (bodyStr && ['POST', 'PUT', 'PATCH'].includes(method)) {
            options.body = bodyStr;
        }

        const res = await fetch(url, options);
        const contentType = res.headers.get('content-type') ?? '';
        const text = contentType.includes('application/json')
            ? JSON.stringify(await res.json(), null, 2)
            : await res.text();

        const preview = text.length > 2000 ? text.substring(0, 2000) + '\n...[truncated]' : text;
        return `HTTP ${res.status} ${res.statusText}\n\n${preview}`;
    },
});
