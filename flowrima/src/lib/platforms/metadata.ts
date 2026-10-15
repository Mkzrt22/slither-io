import "server-only";

/**
 * Track metadata from OFFICIAL public endpoints only (oEmbed / public APIs).
 * These never return full lyrics or audio — by design. No scraping, no
 * download (Genius, Musixmatch, YouTube/Spotify audio are off-limits).
 *
 * SSRF protection: we never fetch the user's URL; we parse an ID from it and
 * call a fixed, allow-listed API host (Deezer short links are resolved with a
 * HEAD request restricted to Deezer hosts).
 */
export type MetaPlatform = "spotify" | "deezer" | "youtube" | "soundcloud" | "apple_music";

export interface TrackMetadata {
  platform: MetaPlatform;
  url: string;
  title: string | null;
  coverUrl: string | null;
  releaseDate: string | null; // YYYY-MM-DD
  durationSeconds: number | null;
}

const TIMEOUT = 6000;

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function detectPlatform(raw: string): { platform: MetaPlatform; url: URL } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  if (host === "open.spotify.com") return { platform: "spotify", url };
  if (["deezer.com", "deezer.page.link", "link.deezer.com"].includes(host)) return { platform: "deezer", url };
  if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) return { platform: "youtube", url };
  if (["soundcloud.com", "on.soundcloud.com", "m.soundcloud.com"].includes(host)) return { platform: "soundcloud", url };
  if (host === "music.apple.com") return { platform: "apple_music", url };
  return null;
}

const normDate = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : d && /^\d{4}$/.test(d) ? `${d}-01-01` : null);

async function deezer(url: URL): Promise<Partial<TrackMetadata>> {
  let target = url;
  if (url.hostname !== "www.deezer.com" && url.hostname !== "deezer.com") {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
      const loc = res.headers.get("location");
      if (loc) {
        const next = new URL(loc, url);
        if (/(^|\.)deezer\.com$/.test(next.hostname)) target = next;
      }
    } catch {
      return {};
    }
  }
  const id = target.pathname.match(/\/track\/(\d+)/)?.[1];
  if (!id) return {};
  const t = await getJSON<{ title?: string; duration?: number; release_date?: string; album?: { cover_xl?: string } }>(
    `https://api.deezer.com/track/${id}`,
  );
  return t
    ? { title: t.title ?? null, durationSeconds: t.duration ?? null, releaseDate: normDate(t.release_date), coverUrl: t.album?.cover_xl ?? null }
    : {};
}

async function oembed(endpoint: string, url: URL): Promise<Partial<TrackMetadata>> {
  const o = await getJSON<{ title?: string; thumbnail_url?: string }>(`${endpoint}${encodeURIComponent(url.toString())}`);
  return o ? { title: o.title ?? null, coverUrl: o.thumbnail_url ?? null } : {};
}

async function youtubeDetails(url: URL): Promise<Partial<TrackMetadata>> {
  const key = process.env.YOUTUBE_API_KEY;
  const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
  if (!key || !id || !/^[\w-]{6,20}$/.test(id)) return {};
  const r = await getJSON<{ items?: Array<{ snippet?: { publishedAt?: string }; contentDetails?: { duration?: string } }> }>(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}&key=${key}`,
  );
  const item = r?.items?.[0];
  const d = item?.contentDetails?.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const seconds = d ? Number(d[1] ?? 0) * 3600 + Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0) : null;
  return { releaseDate: normDate(item?.snippet?.publishedAt), durationSeconds: seconds };
}

async function appleMusic(url: URL): Promise<Partial<TrackMetadata>> {
  const id = url.searchParams.get("i") ?? url.pathname.match(/\/song\/[^/]+\/(\d+)/)?.[1];
  if (!id || !/^\d+$/.test(id)) return {};
  const r = await getJSON<{ results?: Array<{ trackName?: string; releaseDate?: string; trackTimeMillis?: number; artworkUrl100?: string }> }>(
    `https://itunes.apple.com/lookup?id=${id}`,
  );
  const t = r?.results?.[0];
  return t
    ? {
        title: t.trackName ?? null,
        releaseDate: normDate(t.releaseDate),
        durationSeconds: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
        coverUrl: t.artworkUrl100?.replace("100x100", "600x600") ?? null,
      }
    : {};
}

export async function fetchTrackMetadata(raw: string): Promise<TrackMetadata | null> {
  const detected = detectPlatform(raw);
  if (!detected) return null;
  const { platform, url } = detected;
  let meta: Partial<TrackMetadata> = {};
  switch (platform) {
    case "spotify":
      meta = await oembed("https://open.spotify.com/oembed?url=", url);
      break;
    case "deezer":
      meta = await deezer(url);
      break;
    case "youtube":
      meta = { ...(await oembed("https://www.youtube.com/oembed?format=json&url=", url)), ...(await youtubeDetails(url)) };
      break;
    case "soundcloud":
      meta = await oembed("https://soundcloud.com/oembed?format=json&url=", url);
      break;
    case "apple_music":
      meta = await appleMusic(url);
      break;
  }
  return {
    platform,
    url: url.toString(),
    title: meta.title ?? null,
    coverUrl: meta.coverUrl ?? null,
    releaseDate: meta.releaseDate ?? null,
    durationSeconds: meta.durationSeconds ?? null,
  };
}
