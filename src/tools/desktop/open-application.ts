import { registerTool } from '../../core/dispatcher';
import { assertDesktopControl, launchApplication } from './desktop-utils';

registerTool({
    name: 'open_application',
    description:
        'Abre una aplicación en el PC local (Spotify, Chrome, Notepad, Calculadora, Explorador, VS Code, etc.). ' +
        'Usar cuando pidan abrir, lanzar o iniciar un programa. ' +
        'Requiere DESKTOP_CONTROL_ENABLED=true en el PC donde corre el agente.',
    parameters: {
        type: 'object',
        properties: {
            app_name: {
                type: 'string',
                description:
                    'Nombre de la app: Spotify, Chrome, Notepad, Calculadora, Explorador, Telegram, WhatsApp, VS Code…',
            },
        },
        required: ['app_name'],
    },
    handler: async (args) => {
        assertDesktopControl();
        const appName = String(args.app_name ?? '').trim();
        if (!appName) throw new Error('Indica qué aplicación abrir.');
        await launchApplication(appName);
        return `✅ Aplicación abierta: ${appName}`;
    },
});
