import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export interface TikTokTextVideoProps {
    hook: string;
    lines: string[];
    cta?: string;
    accent?: string;
    author?: string;
}

const HOOK_START   = 0;
const HOOK_DUR     = 30;
const HOOK_HOLD    = 50;  // hold hook alone before lines
const LINE_STAGGER = 28;
const LINE_START   = 80;

export function calcTikTokDuration(lineCount: number): number {
    const lastLine = LINE_START + (lineCount - 1) * LINE_STAGGER + 20;
    return lastLine + 100; // hold + CTA
}

export const TikTokTextVideo: React.FC<TikTokTextVideoProps> = ({
    hook,
    lines,
    cta = '¡Sígueme para más! 👇',
    accent = '#8b5cf6',
    author = '@zirox.io',
}) => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();

    const hookSpring = spring({ frame, fps, config: { damping: 16, stiffness: 70 }, durationInFrames: HOOK_DUR });
    const hookY       = interpolate(hookSpring, [0, 1], [50, 0]);
    const hookOpacity = hookSpring;

    const outroStart    = durationInFrames - 70;
    const outroProgress = spring({
        frame: Math.max(0, frame - outroStart),
        fps,
        config: { damping: 20, stiffness: 100 },
        durationInFrames: 30,
    });

    return (
        <AbsoluteFill style={{
            background: '#050508',
            fontFamily: "'Segoe UI', 'SF Pro Display', -apple-system, system-ui, sans-serif",
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            paddingTop: 200,
            paddingLeft: 72,
            paddingRight: 72,
        }}>
            {/* Background glow */}
            <AbsoluteFill style={{ pointerEvents: 'none' }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    background: `radial-gradient(ellipse 80% 60% at 50% 30%, ${accent}12 0%, transparent 65%)`,
                }} />
                <div style={{
                    position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
                    width: '80%', height: '40%',
                    background: `radial-gradient(ellipse at center bottom, ${accent}0c 0%, transparent 65%)`,
                    filter: 'blur(60px)',
                }} />
            </AbsoluteFill>

            {/* Hook — large centered text */}
            <div style={{
                color: '#f8fafc',
                fontSize: 88,
                fontWeight: 900,
                lineHeight: 1.08,
                textAlign: 'center',
                marginBottom: 80,
                transform: `translateY(${hookY}px)`,
                opacity: hookOpacity,
                letterSpacing: '-0.03em',
                maxWidth: '100%',
            }}>
                {hook}
            </div>

            {/* Accent divider */}
            <div style={{
                width: 64, height: 4, borderRadius: 2,
                background: accent,
                marginBottom: 64,
                opacity: interpolate(hookSpring, [0, 1], [0, 0.8]),
            }} />

            {/* Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32, width: '100%' }}>
                {lines.map((line, i) => {
                    const lineFrame = LINE_START + i * LINE_STAGGER;
                    const sp = spring({
                        frame: Math.max(0, frame - lineFrame),
                        fps,
                        config: { damping: 22, stiffness: 120 },
                        durationInFrames: 22,
                    });
                    return (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 20,
                            transform: `translateX(${interpolate(sp, [0, 1], [-40, 0])}px)`,
                            opacity: sp,
                        }}>
                            <div style={{
                                width: 10, height: 10, borderRadius: '50%',
                                background: accent, flexShrink: 0,
                                marginTop: 18,
                                boxShadow: `0 0 12px ${accent}88`,
                            }} />
                            <div style={{
                                color: 'rgba(248,250,252,0.88)',
                                fontSize: 46,
                                fontWeight: 500,
                                lineHeight: 1.4,
                            }}>
                                {line}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* CTA + Author */}
            <div style={{
                position: 'absolute',
                bottom: 120,
                left: 72, right: 72,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 20,
                opacity: outroProgress,
                transform: `translateY(${interpolate(outroProgress, [0, 1], [24, 0])}px)`,
            }}>
                <div style={{
                    color: '#f8fafc',
                    fontSize: 52,
                    fontWeight: 700,
                    textAlign: 'center',
                }}>
                    {cta}
                </div>
                <div style={{
                    color: accent,
                    fontSize: 34,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                }}>
                    {author}
                </div>
            </div>
        </AbsoluteFill>
    );
};
