import { registerTool } from '../../core/dispatcher';
import { assertDesktopControl, sendVolumeKey, sendVolumeKeys } from './desktop-utils';

registerTool({
    name: 'system_control',
    description:
        'Control básico del PC Windows local: subir/bajar volumen o silenciar. ' +
        'Usar cuando pidan volumen, silencio, mute. Requiere DESKTOP_CONTROL_ENABLED=true.',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'volume_up | volume_down | mute | unmute',
                enum: ['volume_up', 'volume_down', 'mute', 'unmute'],
            },
            steps: {
                type: 'string',
                description: 'Para volume_up/down: cuántos pasos (1-20). Default 3.',
            },
        },
        required: ['action'],
    },
    handler: async (args) => {
        assertDesktopControl();
        const action = String(args.action ?? '').toLowerCase();
        const steps = Math.min(Math.max(parseInt(String(args.steps ?? '3'), 10) || 3, 1), 20);

        switch (action) {
            case 'volume_up':
                await sendVolumeKeys('up', steps);
                return `🔊 Volumen subido (${steps} pasos).`;
            case 'volume_down':
                await sendVolumeKeys('down', steps);
                return `🔉 Volumen bajado (${steps} pasos).`;
            case 'mute':
                await sendVolumeKey('mute');
                return '🔇 Silencio activado.';
            case 'unmute':
                await sendVolumeKey('mute');
                return '🔊 Silencio desactivado (toggle).';
            default:
                throw new Error(`Acción no soportada: ${action}`);
        }
    },
});
