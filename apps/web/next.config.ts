import { existsSync } from 'node:fs';
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
  // Billing exports (up to 10 MB) pass through a server action on their way to the API.
  experimental: { serverActions: { bodySizeLimit: '11mb' } },
};

export default nextConfig;
