import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // Remotion uses platform-specific native binaries resolved at runtime.
    // Bundling them at build time breaks cross-platform Docker builds.
    serverExternalPackages: [
        'remotion',
        '@remotion/renderer',
        '@remotion/bundler',
        '@remotion/cli',
        '@remotion/compositor-linux-x64-musl',
        '@remotion/compositor-linux-x64-gnu',
        '@remotion/compositor-linux-arm64-musl',
        '@remotion/compositor-linux-arm64-gnu',
    ],
};

export default nextConfig;
