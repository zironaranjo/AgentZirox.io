import OpenAI from 'openai';

export interface DimensionResult {
    score: number;
    summary: string;
    findings: string[];
    quick_wins: string[];
}

export type DimensionKey = 'copy' | 'seo' | 'conversion' | 'brand' | 'strategy';

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
    copy:       'Copywriting & Mensajes',
    seo:        'SEO On-Page',
    conversion: 'Conversión (CRO)',
    brand:      'Identidad de Marca',
    strategy:   'Estrategia Digital',
};

const DIMENSION_PROMPTS: Record<DimensionKey, string> = {
    copy: `Analiza el copywriting y mensajes de esta web. Evalúa:
- Claridad y fuerza de la propuesta de valor principal
- Titular (H1): impacto, claridad, beneficio
- Subtítulos y estructura narrativa
- Beneficios vs características (¿hablan del cliente o del producto?)
- CTAs: cantidad, posición, texto, urgencia
- Tono: ¿conecta con el cliente ideal?
- Prueba social: testimonios, logos, números
- Storytelling y persuasión`,

    seo: `Analiza la optimización SEO on-page de esta web. Evalúa:
- Estructura de headings (H1, H2, H3)
- Densidad y naturalidad de keywords
- Meta descripción y title (si visible en el contenido)
- Contenido: longitud, profundidad, valor informativo
- Interno linking y estructura de navegación
- Velocidad percibida (menciones de imágenes pesadas, scripts bloqueantes)
- Datos estructurados (FAQ, reviews, breadcrumbs)
- Blog o contenido educativo`,

    conversion: `Analiza la optimización de conversión (CRO) de esta web. Evalúa:
- Fricción en el flujo principal (¿cuántos pasos para convertir?)
- Formularios: campos, claridad, friction
- CTAs: visibilidad, contraste, texto de acción
- Trust signals: certificados, garantías, política de devolución
- Urgencia y escasez: ¿hay elementos que impulsen acción inmediata?
- Social proof: número de reviews, rating visible, casos de éxito
- Jerarquía visual: ¿queda claro qué hacer primero?
- Exit intent o captación de leads secundarios`,

    brand: `Analiza la identidad de marca de esta web. Evalúa:
- Coherencia visual (colores, tipografía, estilo de imágenes)
- Claridad del posicionamiento: ¿quién eres y para quién?
- Diferenciación: ¿por qué tú y no la competencia?
- Tono de voz: ¿es consistente en toda la web?
- Valores de marca: ¿se comunican o quedan implícitos?
- Profesionalismo y confianza transmitida
- Nombre, logo y tagline: ¿son memorables y relevantes?`,

    strategy: `Analiza la estrategia de marketing digital de esta web. Evalúa:
- Embudo de ventas: ¿hay etapas TOFU/MOFU/BOFU claras?
- Captación de leads: newsletter, lead magnets, pop-ups
- Canales de tráfico evidentes (redes sociales, blog, SEO, ads)
- Retargeting y remarketing (pixel, tags visibles)
- Email marketing o secuencias de nurturing
- Presencia en buscadores: ¿posiciona para sus keywords?
- Monetización: ¿el modelo de negocio es claro para el visitante?
- Potencial de crecimiento y brechas estratégicas evidentes`,
};

function getClient(): OpenAI {
    return new OpenAI({
        apiKey:   process.env.OPENROUTER_API_KEY ?? '',
        baseURL:  'https://openrouter.ai/api/v1',
        defaultHeaders: {
            'HTTP-Referer': 'https://zirox.io',
            'X-Title':      'AgenteZirox-MarketingAudit',
        },
    });
}

export async function analyzeDimension(
    content: string,
    dim: DimensionKey
): Promise<DimensionResult> {
    const client = getClient();
    const model  = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-6';

    const response = await client.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: `Eres un consultor senior de marketing digital con 10+ años de experiencia.
Analiza el contenido web que te dan y devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin texto extra):
{
  "score": <número entero del 0 al 100>,
  "summary": "<1-2 oraciones describiendo el estado general de esta dimensión>",
  "findings": ["<hallazgo específico 1>", "<hallazgo específico 2>", "<hallazgo específico 3>"],
  "quick_wins": ["<acción concreta y accionable 1>", "<acción concreta 2>", "<acción concreta 3>"]
}

Los findings describen lo que ves (positivo o negativo).
Los quick_wins son mejoras específicas y realizables en menos de 1 semana.
Sé específico con ejemplos del contenido real de la web.`,
            },
            {
                role: 'user',
                content: `${DIMENSION_PROMPTS[dim]}\n\n---\nCONTENIDO DE LA WEB:\n\n${content.slice(0, 6000)}`,
            },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 900,
        temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    let parsed: Partial<DimensionResult> = {};
    try { parsed = JSON.parse(raw); } catch { /* keep empty */ }

    return {
        score:      Math.min(100, Math.max(0, Math.round(Number(parsed.score ?? 50)))),
        summary:    String(parsed.summary ?? ''),
        findings:   Array.isArray(parsed.findings)   ? parsed.findings.slice(0, 5).map(String)   : [],
        quick_wins: Array.isArray(parsed.quick_wins) ? parsed.quick_wins.slice(0, 5).map(String) : [],
    };
}
