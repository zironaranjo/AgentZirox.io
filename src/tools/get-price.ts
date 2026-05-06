import { registerTool } from '../core/dispatcher';

async function getCryptoPrices(coins: string[]): Promise<string> {
    const ids = coins.join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd,eur&include_24hr_change=true`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko error ${res.status}`);
    const data = (await res.json()) as Record<
        string,
        { usd?: number; eur?: number; usd_24h_change?: number }
    >;

    const lines = Object.entries(data).map(([id, v]) => {
        const change = v.usd_24h_change != null ? ` (${v.usd_24h_change > 0 ? '+' : ''}${v.usd_24h_change.toFixed(2)}% 24h)` : '';
        return `• **${id}**: $${v.usd?.toLocaleString('en-US')} / €${v.eur?.toLocaleString('es-ES')}${change}`;
    });

    return lines.length > 0 ? lines.join('\n') : 'No se encontraron datos para esas monedas.';
}

async function getStockPrice(symbol: string): Promise<string> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=1d&range=1d`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Yahoo Finance error ${res.status} para ${symbol}`);
    const data = (await res.json()) as {
        chart?: {
            result?: Array<{
                meta?: { regularMarketPrice?: number; currency?: string; shortName?: string; regularMarketChangePercent?: number };
            }>;
            error?: { description?: string };
        };
    };

    if (data.chart?.error) throw new Error(data.chart.error.description ?? 'Error Yahoo Finance');
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error(`No hay datos para el símbolo ${symbol}`);

    const change = meta.regularMarketChangePercent != null
        ? ` (${meta.regularMarketChangePercent > 0 ? '+' : ''}${meta.regularMarketChangePercent.toFixed(2)}%)`
        : '';
    const name = meta.shortName ? `${meta.shortName} ` : '';
    return `• **${name}(${symbol.toUpperCase()})**: ${meta.regularMarketPrice.toLocaleString('en-US')} ${meta.currency ?? 'USD'}${change}`;
}

// Map common names/tickers to CoinGecko IDs
const CRYPTO_ALIASES: Record<string, string> = {
    btc: 'bitcoin', bitcoin: 'bitcoin',
    eth: 'ethereum', ethereum: 'ethereum',
    sol: 'solana', solana: 'solana',
    bnb: 'binancecoin', ada: 'cardano', cardano: 'cardano',
    xrp: 'ripple', ripple: 'ripple',
    doge: 'dogecoin', dogecoin: 'dogecoin',
    dot: 'polkadot', polkadot: 'polkadot',
    matic: 'matic-network', polygon: 'matic-network',
    avax: 'avalanche-2', avalanche: 'avalanche-2',
    link: 'chainlink', chainlink: 'chainlink',
    usdt: 'tether', tether: 'tether',
    usdc: 'usd-coin',
    ltc: 'litecoin', litecoin: 'litecoin',
};

registerTool({
    name: 'get_price',
    description:
        'Consulta el precio actual de criptomonedas (Bitcoin, Ethereum, Solana, etc.) o acciones/ETFs (AAPL, TSLA, AMZN, SPY...). Usar cuando el usuario pregunte por precios, cotizaciones o valores de mercado.',
    parameters: {
        type: 'object',
        properties: {
            symbols: {
                type: 'string',
                description:
                    'Lista de símbolos o nombres separados por coma. Ej: "bitcoin, ethereum" o "AAPL, TSLA" o mezclados: "BTC, AAPL"',
            },
        },
        required: ['symbols'],
    },
    handler: async (args) => {
        const raw = String(args.symbols ?? '').trim();
        if (!raw) throw new Error('symbols es obligatorio');

        const items = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const cryptoIds: string[] = [];
        const stockSymbols: string[] = [];

        for (const item of items) {
            const cgId = CRYPTO_ALIASES[item] ?? (item.length > 2 && !item.match(/^[A-Z0-9]{1,5}$/i) ? item : null);
            if (cgId) {
                cryptoIds.push(cgId);
            } else {
                stockSymbols.push(item.toUpperCase());
            }
        }

        const results: string[] = [];

        if (cryptoIds.length > 0) {
            try {
                const crypto = await getCryptoPrices([...new Set(cryptoIds)]);
                results.push(`📈 **Crypto:**\n${crypto}`);
            } catch (e) {
                results.push(`❌ Crypto: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        for (const sym of stockSymbols) {
            try {
                const stock = await getStockPrice(sym);
                results.push(`📊 **Acción/ETF:**\n${stock}`);
            } catch (e) {
                results.push(`❌ ${sym}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        return results.join('\n\n') || 'No se encontraron precios.';
    },
});
