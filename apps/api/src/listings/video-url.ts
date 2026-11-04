/**
 * Video links on a public deal page: YouTube and Vimeo only, reduced to provider and id.
 * The pasted URL is never stored or rendered; pages embed the provider's privacy-enhanced player.
 */
export type VideoProvider = 'YOUTUBE' | 'VIMEO';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{1,12}$/;

export function parseVideoUrl(input: string): { provider: VideoProvider; id: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') {
    const id = segments[0] ?? '';
    return YOUTUBE_ID.test(id) ? { provider: 'YOUTUBE', id } : null;
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const id = segments[0] === 'watch' ? (url.searchParams.get('v') ?? '') : ['shorts', 'embed', 'live'].includes(segments[0] ?? '') ? (segments[1] ?? '') : '';
    return YOUTUBE_ID.test(id) ? { provider: 'YOUTUBE', id } : null;
  }
  if (VIMEO_HOSTS.has(host)) {
    const id = host === 'player.vimeo.com' ? (segments[0] === 'video' ? (segments[1] ?? '') : '') : (segments[0] ?? '');
    return VIMEO_ID.test(id) ? { provider: 'VIMEO', id } : null;
  }
  return null;
}
