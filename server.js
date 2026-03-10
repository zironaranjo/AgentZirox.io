import { createServer } from "http";
import { parse } from "url";
import next from "next";

// Import your custom systems
import './src/core/logger.js';
import { logger } from './src/core/logger.js';
import { initMemory } from './src/core/memory.js';
import { startTelegramBot } from './src/integrations/telegram/bot.js';

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const AGENT_NAME = process.env.AGENT_NAME ?? 'AgenteZirox';
const AGENT_VERSION = process.env.AGENT_VERSION ?? '1.0.0';

app.prepare().then(async () => {
  logger.info(`🤖 ${AGENT_NAME} v${AGENT_VERSION} starting Next.js Monolith...`);

  // 1. Initialize custom backend systems
  try {
    await initMemory();
    logger.info('✅ Persistent Memory initialized');

    await startTelegramBot();
    logger.info('✅ Telegram bot started — @AgentZiroxio_bot');
  } catch (error) {
    logger.error('❌ Failed to initialize background services:', error);
  }

  // 2. Start the web server
  createServer(async (req, res) => {
    try {
      if (!req.url) return;
      
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  })
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      logger.info(`🚀 Next.js + Bot is online at http://${hostname}:${port}`);
    });
});
