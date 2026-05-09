export function visionAvailable(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export async function analyzeImageBase64(
    base64: string,
    mimeType: string,
    caption?: string
): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENROUTER_API_KEY no configurado para análisis de imagen');

    const model = process.env.OPENROUTER_VISION_MODEL ?? 'openai/gpt-4o-mini';
    const prompt =
        (caption?.trim() ? `El usuario dice: "${caption.trim()}"\n\n` : '') +
        'Analiza esta imagen en español. Sé concreto y describe lo más relevante.';

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://agentezirox.io',
            'X-Title': 'AgenteZirox',
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                    ],
                },
            ],
            temperature: 0.2,
            max_tokens: 500,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Vision API error (${res.status}): ${err.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('El modelo no devolvió análisis de imagen');
    return content;
}
