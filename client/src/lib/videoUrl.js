// Parses a pasted URL and figures out how to play it.
// Supports:
//  - YouTube links (youtube.com/watch, youtu.be, shorts)
//  - Google Drive share links (various formats)
//  - Direct video file URLs (.mp4, .webm, .ogg, .mov, m3u8)

export function parseVideoUrl(rawUrl) {
  const url = rawUrl.trim();

  const youtubeMatch =
    url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);

  if (youtubeMatch) {
    return {
      type: 'youtube',
      videoId: youtubeMatch[1],
      playableUrl: null,
      previewUrl: null,
    };
  }

  const driveMatch =
    url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  if (url.includes('drive.google.com') && driveMatch) {
    const fileId = driveMatch[1];
    return {
      type: 'drive',
      fileId,
      // Direct-download style endpoint - works as a <video> src IF the file
      // is shared as "Anyone with the link". This lets us use a real <video>
      // element (needed for volume boost + tight sync) instead of Drive's
      // iframe preview player.
      playableUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      // Fallback iframe preview (used if direct playback fails, e.g. CORS/large file)
      previewUrl: `https://drive.google.com/file/d/${fileId}/preview`,
    };
  }

  // Direct file / stream URL
  return {
    type: 'direct',
    playableUrl: url,
    previewUrl: null,
  };
}

export function detectVideoType(rawUrl) {
  return parseVideoUrl(rawUrl).type; // 'youtube' | 'drive' | 'direct'
}
