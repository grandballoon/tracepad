// Parse what a person pastes (a YouTube link or a bare id) into a video id
// and an optional start time. Pure: string in, value out.

const ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_PREFIXES = ["/embed/", "/shorts/", "/live/", "/v/"];

/**
 * @param {string} input
 * @returns {{ id: string, start: number } | null}
 */
export function parseVideo(input) {
  const text = String(input ?? "").trim();
  if (ID.test(text)) return { id: text, start: 0 };

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v");
    if (!id) {
      const prefix = PATH_PREFIXES.find((p) => url.pathname.startsWith(p));
      if (prefix) id = url.pathname.slice(prefix.length).split("/")[0];
    }
  }
  if (!id || !ID.test(id)) return null;

  return { id, start: parseStart(url.searchParams.get("t") ?? url.searchParams.get("start")) };
}

/**
 * YouTube start times look like "90", "90s", "1m30s" or "1h2m3s".
 * @param {string | null} value
 * @returns {number} seconds, 0 when absent or unreadable
 */
export function parseStart(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || match[0] === "") return 0;
  const [, h = 0, m = 0, s = 0] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
