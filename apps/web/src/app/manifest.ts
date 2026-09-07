import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Runner OS',
    short_name: 'RunnerOS',
    description: 'Personal athletic operating system.',
    start_url: '/today',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#EAE3CF',
    theme_color: '#EAE3CF',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
