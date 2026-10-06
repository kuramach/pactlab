import type { NextConfig } from 'next';

/**
 * Marketing site for pactlab.ai: fully static (`next build` writes `out/`),
 * so it can be served from any static host or CDN with no server.
 */
const nextConfig: NextConfig = {
  output: 'export',
  // product/index.html rather than product.html: serves /product on any static host.
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // The dev server would otherwise write AGENTS.md / CLAUDE.md into this app on every start.
  agentRules: false,
};

export default nextConfig;
