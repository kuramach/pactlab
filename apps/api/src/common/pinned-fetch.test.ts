import { describe, expect, it } from 'vitest';
import { pinnedHttpsFetch } from './pinned-fetch';

const fetch = pinnedHttpsFetch({ maxBytes: 1024, timeoutMs: 2_000 });

describe('pinned https fetch (MCP evidence servers, T-084c)', () => {
  it('refuses http, user info and blocked address literals before connecting', async () => {
    for (const url of [
      'http://mcp.example.com/mcp',
      'https://user:pw@mcp.example.com/mcp',
      'https://127.0.0.1/mcp',
      'https://[::1]/mcp',
      'https://169.254.169.254/latest',
      'https://10.0.0.5/mcp',
    ])
      await expect(fetch(url, { method: 'POST', body: '{}' }), url).rejects.toThrow(/refused/);
  });

  it('refuses a name that resolves to a blocked address', async () => {
    await expect(fetch('https://localhost/mcp', { method: 'POST', body: '{}' })).rejects.toThrow(
      /refused|failed/,
    );
  });
});
