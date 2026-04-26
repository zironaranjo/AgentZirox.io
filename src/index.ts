import 'dotenv/config';
import { startTelegramBot } from './integrations/telegram/bot';
import { initMemory } from './core/memory';
import { logger } from './core/logger';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_NAME = process.env.AGENT_NAME ?? 'AgenteZirox';
const AGENT_VERSION = process.env.AGENT_VERSION ?? '1.0.0';

const app = express();
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

// Simple API endpoint to handle chat from the web interface
app.post('/api/chat', async (req: express.Request, res: express.Response) => {
    try {
        const userMessage = req.body.message;
        // Mock response so the user can test the chat interface right away.
        // We can hook this up to the actual AI core next.
        const reply = `He procesado tu mensaje: "${userMessage}". Mi conexión directa al cerebro de IA estará lista muy pronto.`;
        
        res.json({ reply });
    } catch (error) {
        logger.error('Error en /api/chat:', error);
        res.status(500).json({ reply: 'Error interno en mis sistemas neuronales.' });
    }
});

const PORT = process.env.PORT || 3000;

async function main() {
    logger.info(`🤖 ${AGENT_NAME} v${AGENT_VERSION} starting...`);

    // Initialize persistent memory (SQLite o Supabase según .env)
    await initMemory();
    logger.info('✅ Memory initialized');

    // Start Telegram Bot
    await startTelegramBot();
    logger.info('✅ Telegram bot started — @AgentZiroxio_bot');

    // Start Web Server
    app.listen(PORT, () => {
        logger.info(`🌐 Web Interface online at http://localhost:${PORT}`);
    });

    logger.info(`🚀 ${AGENT_NAME} is online and ready!`);
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
