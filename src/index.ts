import 'dotenv/config';
import { startTelegramBot } from './integrations/telegram/bot.js';
import { initMemory } from './core/memory.js';
import { logger } from './core/logger.js';

const AGENT_NAME = process.env.AGENT_NAME ?? 'AgenteZirox';
const AGENT_VERSION = process.env.AGENT_VERSION ?? '1.0.0';

async function main() {
    logger.info(`🤖 ${AGENT_NAME} v${AGENT_VERSION} starting...`);

    // Initialize persistent memory (SQLite)
    await initMemory();
    logger.info('✅ Memory initialized');

    // Start Telegram Bot
    await startTelegramBot();
    logger.info('✅ Telegram bot started — @AgentZiroxio_bot');

    logger.info(`🚀 ${AGENT_NAME} is online and ready!`);
}

main().catch((err) => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
