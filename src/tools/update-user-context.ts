import { registerTool } from '../core/dispatcher';
import { getUserContext, saveUserContext } from '../core/memory';

registerTool({
    name: 'update_user_context',
    description:
        'Actualiza el contexto estructurado del usuario: proyectos activos, objetivos, decisiones importantes y foco actual. Úsalo cuando el usuario comparta información sobre sus proyectos, metas o cuando tome decisiones relevantes que deban recordarse entre conversaciones.',
    parameters: {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['set_focus', 'add_project', 'update_project', 'remove_project', 'add_goal', 'remove_goal', 'add_decision', 'get'],
                description: 'Operación a realizar',
            },
            name: {
                type: 'string',
                description: 'Nombre del proyecto u objetivo (para operaciones de proyecto/objetivo)',
            },
            description: {
                type: 'string',
                description: 'Descripción del proyecto o detalle de la decisión',
            },
            status: {
                type: 'string',
                enum: ['active', 'paused', 'done'],
                description: 'Estado del proyecto',
            },
            focus: {
                type: 'string',
                description: 'Foco actual del usuario (para set_focus)',
            },
            goal: {
                type: 'string',
                description: 'Objetivo a añadir o eliminar',
            },
            decision: {
                type: 'string',
                description: 'Decisión tomada (para add_decision)',
            },
            reason: {
                type: 'string',
                description: 'Motivo de la decisión (opcional)',
            },
        },
        required: ['operation'],
    },
    handler: async (args) => {
        const { operation, name, description, status, focus, goal, decision, reason } = args as {
            operation: string;
            name?: string;
            description?: string;
            status?: 'active' | 'paused' | 'done';
            focus?: string;
            goal?: string;
            decision?: string;
            reason?: string;
        };

        const ctx = await getUserContext();

        switch (operation) {
            case 'get': {
                if (!ctx.projects.length && !ctx.goals.length && !ctx.current_focus && !ctx.decisions.length) {
                    return 'No hay contexto guardado aún.';
                }
                const lines: string[] = [];
                if (ctx.current_focus) lines.push(`🎯 Foco: ${ctx.current_focus}`);
                if (ctx.projects.length) {
                    lines.push('📁 Proyectos:');
                    ctx.projects.forEach((p) => lines.push(`  • [${p.status}] ${p.name} — ${p.description}`));
                }
                if (ctx.goals.length) lines.push('🏆 Objetivos:\n' + ctx.goals.map((g) => `  • ${g}`).join('\n'));
                if (ctx.decisions.length) {
                    lines.push('💡 Decisiones:');
                    ctx.decisions.slice(-5).forEach((d) => lines.push(`  • ${d.date}: ${d.decision}${d.reason ? ` (${d.reason})` : ''}`));
                }
                return lines.join('\n');
            }

            case 'set_focus': {
                if (!focus) return 'Necesito el parámetro focus.';
                ctx.current_focus = focus.trim();
                await saveUserContext(ctx);
                return `✅ Foco actualizado: "${ctx.current_focus}"`;
            }

            case 'add_project': {
                if (!name) return 'Necesito el nombre del proyecto.';
                const existing = ctx.projects.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
                const project = {
                    name: name.trim(),
                    status: (status ?? 'active') as 'active' | 'paused' | 'done',
                    description: (description ?? '').trim(),
                };
                if (existing !== -1) {
                    ctx.projects[existing] = project;
                    await saveUserContext(ctx);
                    return `✅ Proyecto "${name}" actualizado.`;
                }
                ctx.projects.push(project);
                await saveUserContext(ctx);
                return `✅ Proyecto "${name}" añadido (${project.status}).`;
            }

            case 'update_project': {
                if (!name) return 'Necesito el nombre del proyecto.';
                const idx = ctx.projects.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
                if (idx === -1) return `No encontré el proyecto "${name}".`;
                if (status) ctx.projects[idx].status = status;
                if (description) ctx.projects[idx].description = description.trim();
                await saveUserContext(ctx);
                return `✅ Proyecto "${name}" actualizado.`;
            }

            case 'remove_project': {
                if (!name) return 'Necesito el nombre del proyecto.';
                const before = ctx.projects.length;
                ctx.projects = ctx.projects.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
                if (ctx.projects.length === before) return `No encontré el proyecto "${name}".`;
                await saveUserContext(ctx);
                return `✅ Proyecto "${name}" eliminado.`;
            }

            case 'add_goal': {
                if (!goal) return 'Necesito el parámetro goal.';
                const trimmed = goal.trim();
                if (!ctx.goals.includes(trimmed)) ctx.goals.push(trimmed);
                await saveUserContext(ctx);
                return `✅ Objetivo añadido: "${trimmed}"`;
            }

            case 'remove_goal': {
                if (!goal) return 'Necesito el parámetro goal.';
                const before = ctx.goals.length;
                ctx.goals = ctx.goals.filter((g) => !g.toLowerCase().includes(goal.toLowerCase()));
                if (ctx.goals.length === before) return `No encontré un objetivo que contenga "${goal}".`;
                await saveUserContext(ctx);
                return `✅ Objetivo eliminado.`;
            }

            case 'add_decision': {
                if (!decision) return 'Necesito el parámetro decision.';
                ctx.decisions.push({
                    date: new Date().toISOString().split('T')[0],
                    decision: decision.trim(),
                    reason: reason?.trim(),
                });
                // Keep only last 20 decisions
                if (ctx.decisions.length > 20) ctx.decisions = ctx.decisions.slice(-20);
                await saveUserContext(ctx);
                return `✅ Decisión registrada: "${decision}"`;
            }

            default:
                return `Operación desconocida: ${operation}`;
        }
    },
});
