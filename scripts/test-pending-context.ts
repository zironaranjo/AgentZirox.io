/**
 * Test: verifica que las tareas programadas pendientes aparecen en el system prompt.
 * Ejecutar con: npx tsx scripts/test-pending-context.ts
 */
import 'dotenv/config';
import { initMemory, insertScheduledTask, listPendingScheduledForChat } from '../src/core/memory';
import { runWithToolContext } from '../src/core/tool-context';
import { buildSystemPrompt } from '../src/core/llm';

const CHAT_ID = 'test-chat-99999';

async function run() {
    await initMemory();
    console.log('✅ Memoria inicializada (SQLite)');

    // Insertar tarea de prueba para "mañana a las 9"
    const tomorrow9am = new Date();
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);

    const taskId = await insertScheduledTask(
        CHAT_ID,
        'Buscar 3 noticias de inteligencia artificial y enviarlas al chat',
        tomorrow9am.getTime()
    );
    console.log(`✅ Tarea insertada con id: ${taskId}`);

    // Verificar que la tarea está en DB
    const tasks = await listPendingScheduledForChat(CHAT_ID);
    console.log(`✅ Tareas pendientes en DB: ${tasks.length}`);

    // Simular el contexto de agente (igual que processMessage) y construir el system prompt
    const prompt = await runWithToolContext({ chatId: CHAT_ID }, () => buildSystemPrompt());

    const hasTask = prompt.includes('Tareas programadas pendientes');
    const hasInstruction = prompt.includes('noticias de inteligencia artificial');

    console.log('\n--- Bloque de tareas en el prompt ---');
    const idx = prompt.indexOf('### Tareas programadas pendientes');
    if (idx !== -1) {
        console.log(prompt.slice(idx, idx + 300));
    } else {
        console.log('(bloque no encontrado)');
    }

    console.log('\n--- Resultado ---');
    if (hasTask && hasInstruction) {
        console.log('✅ PASS: Las tareas pendientes aparecen correctamente en el system prompt.');
    } else {
        console.error('❌ FAIL: Las tareas NO aparecen en el system prompt.');
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
