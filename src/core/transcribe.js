// Transcription: one capture's ink goes to Claude, Markdown comes back.
// This file builds the request and reads the reply as plain values; the
// shell only sends it. Raw HTTP rather than the Anthropic SDK: the page has
// no build step and loads no third-party script while it holds the user's key.

import { clockLabel } from "./captures.js";

export const MODEL = "claude-opus-5-5";
export const API_URL = "https://api.anthropic.com/v1/messages";

export const SYSTEM_PROMPT = [
  "You transcribe handwritten notes into Markdown for an Obsidian vault.",
  "The image is ink a learner drew with Apple Pencil over a frame of a math video, so expect sketches of graphs, vectors, grids and arrows alongside handwriting.",
  "Return only the Markdown, with no code fence around it and no commentary.",
  "",
  "- Transcribe handwritten words as text, keeping the writer's wording, line breaks and lists.",
  "- Write math in LaTeX: $...$ inline, and $$...$$ on lines of their own for displayed equations. Write matrices with bmatrix.",
  "- Do not redraw figures: the image is embedded next to your text. For a figure, add one short italic line saying what it shows, only when that helps the notes read on their own.",
  "- Write [?] for anything you cannot read rather than guessing.",
  "- If the image has no writing and no figure, return nothing.",
].join("\n");

/** A key as the Anthropic Console issues it. */
export function looksLikeKey(text) {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(text).trim());
}

/**
 * The fetch arguments for one capture.
 * @param {{ key: string, image: string, title: string, time: number }} input  image is base64 PNG
 */
export function transcribeRequest({ key, image, title, time }) {
  const where = title ? `From "${title}" at ${clockLabel(time)}.` : `At ${clockLabel(time)} in the video.`;
  return {
    url: API_URL,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "medium" },
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
              { type: "text", text: `${where} Transcribe this page.` },
            ],
          },
        ],
      }),
    },
  };
}

/**
 * Read Claude's reply.
 * @returns {{ ok: true, markdown: string } | { ok: false, message: string }}
 */
export function readTranscript(status, body) {
  if (status === 401 || status === 403) return { ok: false, message: "Claude didn't accept the API key. Check it under Claude." };
  if (status === 429) return { ok: false, message: "Claude's rate limit was hit. Try again in a minute." };
  if (status === 529 || status >= 500) return { ok: false, message: "Claude is overloaded right now. Try again in a minute." };
  if (status !== 200) {
    const detail = body?.error?.message;
    return { ok: false, message: detail ? `Claude couldn't transcribe it: ${detail}` : `Claude couldn't transcribe it (error ${status}).` };
  }
  if (body?.stop_reason === "refusal") return { ok: false, message: "Claude declined to transcribe this capture." };
  const text = (Array.isArray(body?.content) ? body.content : [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  return { ok: true, markdown: unfence(text.trim()) };
}

/** Drop one code fence wrapped around the whole reply, if the model added one. */
function unfence(text) {
  const match = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(text);
  return match ? match[1].trim() : text;
}
