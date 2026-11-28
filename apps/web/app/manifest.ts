import type { MetadataRoute } from 'next';
import { CHANNEL_ABOUT, CHANNEL_SENDER } from '@pactlab/domain';

/**
 * The web app manifest (T-146): makes Pactlab installable, which iPhone and iPad need for web push
 * (iOS 16.4+, added to the Home Screen, `display` standalone). Icons are the site's own brand assets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: CHANNEL_SENDER,
    short_name: CHANNEL_SENDER,
    description: CHANNEL_ABOUT,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#081127',
    icons: [
      { src: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/brand/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
