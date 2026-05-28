import React from 'react';
import { registerRoot, Composition } from 'remotion';
import { LinkedInVideo, calcLinkedInDuration, type LinkedInVideoProps } from './LinkedInVideo';
import { TikTokTextVideo, calcTikTokDuration, type TikTokTextVideoProps } from './TikTokTextVideo';

const RemotionRoot: React.FC = () => (
    <>
        <Composition
            id="LinkedInVideo"
            component={LinkedInVideo}
            durationInFrames={600}
            fps={30}
            width={1080}
            height={1080}
            defaultProps={{
                title: 'Tu título aquí',
                lines: ['Primera idea importante', 'Segunda idea clave', 'Tercera reflexión'],
                cta: 'Sígueme para más',
                accent: '#8b5cf6',
                author: 'Ziro · zirox.io',
            } satisfies LinkedInVideoProps}
            calculateMetadata={({ props }) => ({
                durationInFrames: calcLinkedInDuration((props as LinkedInVideoProps).lines.length),
            })}
        />
        <Composition
            id="TikTokTextVideo"
            component={TikTokTextVideo}
            durationInFrames={450}
            fps={30}
            width={1080}
            height={1920}
            defaultProps={{
                hook: '¿Sabías esto?',
                lines: ['Primera idea', 'Segunda idea', 'Tercera idea'],
                cta: '¡Sígueme para más! 👇',
                accent: '#8b5cf6',
                author: '@zirox.io',
            } satisfies TikTokTextVideoProps}
            calculateMetadata={({ props }) => ({
                durationInFrames: calcTikTokDuration((props as TikTokTextVideoProps).lines.length),
            })}
        />
    </>
);

registerRoot(RemotionRoot);
