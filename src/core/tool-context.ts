import { AsyncLocalStorage } from 'node:async_hooks';

export type AgentToolContext = {
    chatId: string;
};

const storage = new AsyncLocalStorage<AgentToolContext>();

export function runWithToolContext<T>(ctx: AgentToolContext, fn: () => Promise<T>): Promise<T> {
    return storage.run(ctx, fn);
}

export function getToolContext(): AgentToolContext | undefined {
    return storage.getStore();
}
