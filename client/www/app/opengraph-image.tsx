import { generateOgImage } from '@/lib/ogImage';

// SidekickDB: alt text names SidekickDB.
export const alt = 'SidekickDB';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return generateOgImage({
    brand: 'instant',
    title: 'The best backend for AI-coded apps',
  });
}
