import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export interface LinkedInVideoProps {
    title: string;
    lines: string[];
    cta?: string;
    accent?: string;
    author?: string;
}

const TITLE_START  = 0;
const TITLE_DUR    = 30;
const LINE_STAGGER = 32; // frames between each line
const LINE_START   = 50; // frame when first line appears

export function calcLinkedInDuration(lineCount: number): number {
    const lastLineFrame = LINE_START + (lineCount - 1) * LINE_STAGGER + 20;
    return lastLineFrame + 120; // hold 4s after last line
}

export const LinkedInVideo: React.FC<LinkedInVideoProps> = ({
    title,
    lines,
    cta = '',
    accent = '#8b5cf6',
    author = 'Ziro · zirox.io',
}) => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();

    const titleSpring = spring({ frame: frame - TITLE_START, fps, config: { damping: 18, stiffness: 80 }, durationInFrames: TITLE_DUR });
    const titleY       = interpolate(titleSpring, [0, 1], [36, 0]);
    const titleOpacity = titleSpring;

    const outroStart = durationInFrames - 60;
    const outroProgress = spring({ frame: Math.max(0, frame - outroStart), fps, config: { damping: 20, stiffness: 100 }, durationInFrames: 30 });

    return (
        <AbsoluteFill style={{
            background: '#050508',
            fontFamily: "'Segoe UI', 'SF Pro Display', -apple-system, system-ui, sans-serif",
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '96px',
        }}>
            {/* Background radial glow */}
            <AbsoluteFill style={{ pointerEvents: 'none' }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    background: `radial-gradient(ellipse 70% 70% at 50% 48%, ${accent}10 0%, transparent 70%)`,
                }} />
                <div style={{
                    position: 'absolute', bottom: '-10%', left: '-5%',
                    width: '55%', height: '60%',
                    background: `radial-gradient(ellipse at center, ${accent}0e 0%, transparent 65%)`,
                    filter: 'blur(48px)',
                }} />
            </AbsoluteFill>

            {/* Accent left bar */}
            <div style={{
                position: 'absolute', left: 0, top: '15%', bottom: '15%',
                width: 6,
                background: `linear-gradient(180deg, transparent, ${accent}, transparent)`,
                opacity: titleOpacity,
            }} />

            {/* Title */}
            <div style={{
                color: '#f8fafc',
                fontSize: 72,
                fontWeight: 800,
                lineHeight: 1.12,
                marginBottom: 56,
                maxWidth: '100%',
                transform: `translateY(${titleY}px)`,
                opacity: titleOpacity,
                letterSpacing: '-0.02em',
            }}>
                {title}
            </div>

            {/* Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: '100%' }}>
                {lines.map((line, i) => {
                    const lineFrame = LINE_START + i * LINE_STAGGER;
                    const sp = spring({
                        frame: Math.max(0, frame - lineFrame),
                        fps,
                        config: { damping: 22, stiffness: 110 },
                        durationInFrames: 24,
                    });
                    return (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 24,
                            transform: `translateY(${interpolate(sp, [0, 1], [28, 0])}px)`,
                            opacity: sp,
                        }}>
                            <div style={{
                                width: 4, height: 40, borderRadius: 2, flexShrink: 0,
                                background: accent,
                                opacity: 0.7,
                            }} />
                            <div style={{
                                color: 'rgba(248,250,252,0.85)',
                                fontSize: 38,
                                fontWeight: 400,
                                lineHeight: 1.45,
                            }}>
                                {line}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div style={{
                position: 'absolute', bottom: 72, left: 96, right: 96,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                opacity: outroProgress,
                transform: `translateY(${interpolate(outroProgress, [0, 1], [16, 0])}px)`,
            }}>
                <div style={{
                    color: accent,
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                }}>
                    {author}
                </div>
                {cta && (
                    <div style={{
                        color: 'rgba(248,250,252,0.45)',
                        fontSize: 26,
                        fontWeight: 500,
                    }}>
                        {cta}
                    </div>
                )}
            </div>
        </AbsoluteFill>
    );
};
