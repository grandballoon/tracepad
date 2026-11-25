// Sends one capture's image to Claude and returns what the core reads from
// the reply. The request and the reading of it are in src/core/transcribe.js.

import { transcribeRequest, readTranscript } from "../core/transcribe.js";

const TIMEOUT_MS = 180_000;

/** @returns {Promise<{ ok: true, markdown: string } | { ok: false, message: string }>} */
export async function transcribe({ key, png, title, time }) {
  const { url, init } = transcribeRequest({ key, image: await toBase64(png), title, time });
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, message: "Couldn't reach Claude. Check the connection and try again." };
  }
  const body = await response.json().catch(() => null);
  return readTranscript(response.status, body);
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
