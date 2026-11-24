// Captures: a moment in the video with the drawing as it stood then.
// Exported as one Markdown note (timestamp links that reopen YouTube at that
// moment) plus one PNG of the ink per capture, named for an Obsidian vault.

import { frameAt } from "./transport.js";
import { isStroke } from "./ink.js";

/** @typedef {import("./ink.js").Stroke} Stroke */
/** @typedef {{ time: number, strokes: Stroke[] }} Capture */

/** Add a capture, replacing one already taken at the same frame. Kept in time order. */
export function addCapture(captures, capture, fps) {
  const frame = frameAt(capture.time, fps);
  const rest = captures.filter((c) => frameAt(c.time, fps) !== frame);
  return [...rest, capture].sort((a, b) => a.time - b.time);
}

export function removeCapture(captures, index) {
  return captures.filter((_, i) => i !== index);
}

/** A link that opens the video at this moment (YouTube accepts whole seconds). */
export function timestampUrl(videoId, time) {
  const seconds = Math.floor(time);
  return seconds > 0 ? `https://youtu.be/${videoId}?t=${seconds}` : `https://youtu.be/${videoId}`;
}

/** "1:05" or "1:02:05" */
export function clockLabel(time) {
  const total = Math.floor(time);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function slugify(text) {
  const slug = String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "video";
}

/** "2026-11-24" from a Date, in local time. */
export function isoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * File names for an export. Image names carry the frame so they sort in
 * video order and never collide within one video.
 */
export function exportNames({ date, title, videoId }, captures, fps) {
  const base = `${isoDate(date)}-${slugify(title || videoId)}`;
  return {
    note: `${base}.md`,
    images: captures.map((c) => `${base}-${String(frameAt(c.time, fps)).padStart(6, "0")}.png`),
  };
}

/** The Markdown note, in the vault's media-source shape. */
export function noteMarkdown({ date, title, videoId }, captures, imageNames) {
  const heading = title || videoId;
  const lines = [
    "---",
    `title: ${JSON.stringify(heading)}`,
    `url: "https://www.youtube.com/watch?v=${videoId}"`,
    `date: ${isoDate(date)}`,
    "source: media",
    "tags: [tracepad]",
    "---",
    "",
    `# ${heading}`,
    "",
  ];
  captures.forEach((capture, i) => {
    lines.push(`## [${clockLabel(capture.time)}](${timestampUrl(videoId, capture.time)})`, "");
    lines.push(`![[${imageNames[i]}]]`, "");
  });
  return lines.join("\n");
}

const FORMAT_VERSION = 1;

export function serializeCaptures(captures) {
  return JSON.stringify({ version: FORMAT_VERSION, captures });
}

/** @returns {Capture[]} the saved captures, or [] for anything unreadable */
export function deserializeCaptures(text) {
  try {
    const data = JSON.parse(text);
    if (data?.version !== FORMAT_VERSION || !Array.isArray(data.captures)) return [];
    return data.captures
      .filter((c) => c && Number.isFinite(c.time) && Array.isArray(c.strokes))
      .map((c) => ({ time: c.time, strokes: c.strokes.filter(isStroke) }));
  } catch {
    return [];
  }
}
