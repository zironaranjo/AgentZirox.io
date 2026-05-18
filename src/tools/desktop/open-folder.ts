import { registerTool } from '../../core/dispatcher';
import { assertDesktopControl, openInExplorer, resolveOpenPath } from './desktop-utils';

registerTool({
    name: 'open_folder',
    description:
        'Abre una carpeta en el Explorador de Windows del PC local. ' +
        'Aliases: escritorio, documentos, descargas, workspace, home. ' +
        'También rutas relativas al workspace del agente o rutas bajo el perfil del usuario. ' +
        'Usar cuando pidan abrir, mostrar o ir a una carpeta.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description:
                    'Carpeta: alias (documentos, escritorio), ruta relativa al workspace (clientes/acme) o ruta absoluta bajo el usuario',
            },
        },
        required: ['path'],
    },
    handler: async (args) => {
        assertDesktopControl();
        const input = String(args.path ?? '').trim();
        const resolved = resolveOpenPath(input);
        await openInExplorer(resolved);
        return `📂 Carpeta abierta en el Explorador:\n🧭 ${resolved}`;
    },
});
