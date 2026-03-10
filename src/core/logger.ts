// Simple logger utility
export const logger = {
    info: (msg: string, ...args: unknown[]) =>
        console.log(`[${new Date().toISOString()}] ℹ️  ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) =>
        console.error(`[${new Date().toISOString()}] ❌ ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) =>
        console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`, ...args),
    debug: (msg: string, ...args: unknown[]) =>
        console.debug(`[${new Date().toISOString()}] 🐛 ${msg}`, ...args),
};
