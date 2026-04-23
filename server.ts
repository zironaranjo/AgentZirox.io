import { createServer } from "http";
import { parse } from "url";
import next from "next";

// Import your custom systems
import './src/core/logger';
import { logger } from './src/core/logger';
import { initMemory } from './src/core/memory';
import { startScheduledTasksTicker } from './src/core/process-scheduled';
import { startTelegramBot } from './src/integrations/telegram/bot';

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const AGENT_NAME = process.env.AGENT_NAME ?? 'AgenteZirox';
const AGENT_VERSION = process.env.AGENT_VERSION ?? '1.0.0';

app.prepare().then(async () => {
  logger.info(`🤖 ${AGENT_NAME} v${AGENT_VERSION} starting Next.js Monolith...`);

  // 1. Initialize memory first (fast, synchronous-like)
  try {
    await initMemory();
    logger.info('✅ Persistent Memory initialized');
  } catch (error) {
    logger.error('❌ Memory init failed:', error);
  }

  // 2. Start web server IMMEDIATELY — don't wait for bot
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
      logger.info(`🚀 Next.js is online at http://${hostname}:${port}`);

      startScheduledTasksTicker();

      // 3. Start Telegram bot IN BACKGROUND (fire-and-forget)
      // bot.start() is infinite polling — never awaited so it doesn't block
      startTelegramBot()
        .then(() => logger.info('✅ Telegram bot started'))
        .catch((err) => logger.error('❌ Telegram bot failed:', err));
    });
});
