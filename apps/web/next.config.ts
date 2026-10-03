import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Monorepo: configuration lives in the root .env (see .env.example).
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@pactlab/ui', '@pactlab/config', '@pactlab/domain'],
};

export default nextConfig;
