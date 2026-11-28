import { youtubePattern, youtubeParams } from '@/lib/videos';
import { isSelfHosted } from '@/lib/config';

export function YouTube({
  src,
  title = 'YouTube video',
}: {
  src: string;
  title?: string;
}) {
  const match = src.match(youtubePattern);
  const videoId = match ? match[1] : null;

  if (!videoId) return null;

  // SidekickDB: a self-hosted dashboard loads nothing from other hosts, so it
  // links to the video instead of embedding it.
  if (isSelfHosted) {
    return <a href={`https://www.youtube.com/watch?v=${videoId}`}>{title}</a>;
  }

  return (
    <span className="md-video-container block">
      <iframe
        width="100%"
        src={`https://www.youtube.com/embed/${videoId}?${youtubeParams}`}
        title={title}
        allow="autoplay; picture-in-picture"
        allowFullScreen
      />
    </span>
  );
}
