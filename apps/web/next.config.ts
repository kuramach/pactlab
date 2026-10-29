import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Monorepo: configuration lives in the root .env (see .env.example).
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The dev server would otherwise write AGENTS.md / CLAUDE.md into this app on every start.
  agentRules: false,
  transpilePackages: ['@pactlab/ui', '@pactlab/config', '@pactlab/domain'],
  // Import files (up to 50 MB) pass through a server action on their way to the API.
  experimental: { serverActions: { bodySizeLimit: '51mb' } },
  // Container builds (infra/docker/Dockerfile) ship a self-contained server; local `next dev`/`next start` are unchanged.
  ...(process.env['NEXT_STANDALONE'] === '1' ? { output: 'standalone' as const, outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)) } : {}),
};

export default nextConfig;
