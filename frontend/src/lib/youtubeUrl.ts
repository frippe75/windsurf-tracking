/**
 * YouTube URL parsing/validation. Single source of truth — previously
 * duplicated (with subtly different regexes) across ProjectManager,
 * AddResourcesDialog, and Index.
 */

/**
 * Extract the 11-char video id from any common YouTube URL form.
 * Handles watch?v=, youtu.be/, embed/, and trailing query params
 * (?si=, ?is=, &t=, #frag). Returns null if no id is found.
 */
export function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?.*[?&]v=([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** True if the URL is a YouTube link we can attempt to download. */
export function isValidYoutubeUrl(url: string): boolean {
  return extractYoutubeId(url.trim()) !== null;
}

export function youtubeThumbnail(url: string): string | undefined {
  const id = extractYoutubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined;
}
