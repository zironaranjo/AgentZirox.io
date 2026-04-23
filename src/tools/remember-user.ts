import { registerTool } from '../core/dispatcher';
import { appendUserProfileNote, setUserDisplayName } from '../core/memory';

registerTool({
    name: 'remember_about_user',
    description:
        'Guardar de forma persistente el nombre preferido del usuario y/o un dato sobre gustos, preferencias o cómo quiere ser tratado. Usar cuando diga su nombre, "llámame X", "recuerda que me gusta...", "prefiero que...", etc.',
    parameters: {
        type: 'object',
        properties: {
            preferred_name: {
                type: 'string',
                description: 'Nombre o forma de dirigirse al usuario (ej. Ziro, tú nombre corto)',
            },
            preference_note: {
                type: 'string',
                description: 'Un hecho breve a recordar (gusto, estilo de respuesta, tabú, idioma, etc.)',
            },
        },
        required: [],
    },
    handler: async (args) => {
        const { preferred_name, preference_note } = args as {
            preferred_name?: string;
            preference_note?: string;
        };

        const name = preferred_name?.trim() ?? '';
        const note = preference_note?.trim() ?? '';

        if (!name && !note) {
            throw new Error('Indica preferred_name y/o preference_note');
        }

        const done: string[] = [];
        if (name) {
            setUserDisplayName(name);
            done.push(`Nombre guardado: ${name}`);
        }
        if (note) {
            appendUserProfileNote(note);
            done.push('Preferencia añadida al perfil.');
        }

        return ['✅ Perfil actualizado (se aplicará en los siguientes mensajes).', ...done].join('\n');
    },
});
