// The drawing as data. Points are normalized to the video frame (0..1 on
// each axis) so the drawing stays registered to the video at any size.
// Sizes are a fraction of the frame width for the same reason.

/** @typedef {[x: number, y: number, pressure: number]} Point */
/** @typedef {{ tool: "pen" | "eraser", color: string, size: number, points: Point[] }} Stroke */
/** @typedef {{ strokes: Stroke[], past: Stroke[][], future: Stroke[][], active: Stroke | null }} Ink */

const FORMAT_VERSION = 1;

/**
 * A point rounded to what the eye can see (1/10000 of the frame), which
 * keeps saved drawings small without moving any line.
 * @returns {Point}
 */
export function point(x, y, pressure) {
  const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
  return [round(x, 4), round(y, 4), round(pressure, 2)];
}

/** @returns {Ink} */
export function emptyInk(strokes = []) {
  return { strokes, past: [], future: [], active: null };
}

/** @param {Ink} ink @param {{ tool: Stroke["tool"], color: string, size: number }} brush @param {Point} point */
export function begin(ink, brush, point) {
  return { ...ink, active: { tool: brush.tool, color: brush.color, size: brush.size, points: [point] } };
}

/** @param {Ink} ink @param {Point[]} points */
export function extend(ink, points) {
  if (!ink.active || points.length === 0) return ink;
  return { ...ink, active: { ...ink.active, points: [...ink.active.points, ...points] } };
}

/** @param {Ink} ink */
export function end(ink) {
  if (!ink.active) return ink;
  return commit({ ...ink, active: null }, [...ink.strokes, ink.active]);
}

/** @param {Ink} ink */
export function cancel(ink) {
  return { ...ink, active: null };
}

/** @param {Ink} ink */
export function clear(ink) {
  if (ink.strokes.length === 0) return { ...ink, active: null };
  return commit({ ...ink, active: null }, []);
}

/** @param {Ink} ink */
export function undo(ink) {
  if (ink.past.length === 0) return ink;
  return {
    strokes: ink.past[ink.past.length - 1],
    past: ink.past.slice(0, -1),
    future: [ink.strokes, ...ink.future],
    active: null,
  };
}

/** @param {Ink} ink */
export function redo(ink) {
  if (ink.future.length === 0) return ink;
  return {
    strokes: ink.future[0],
    past: [...ink.past, ink.strokes],
    future: ink.future.slice(1),
    active: null,
  };
}

function commit(ink, strokes) {
  return { strokes, past: [...ink.past, ink.strokes], future: [], active: ink.active };
}

/**
 * Line width in pixels for a pressure reading. Pencil pressure thins the
 * line but never below a third of the brush, so light strokes stay visible.
 * Devices without pressure report 0.5 (or 0 for a hovering mouse); both map
 * to the full brush.
 */
export function lineWidth(size, pressure, frameWidth) {
  const p = pressure > 0 && pressure !== 0.5 ? pressure : 1;
  return Math.max(0.5, size * frameWidth * (1 / 3 + (2 / 3) * p));
}

/** @param {Stroke[]} strokes */
export function serialize(strokes) {
  return JSON.stringify({ version: FORMAT_VERSION, strokes });
}

/** @returns {Stroke[]} the saved strokes, or [] for anything unreadable */
export function deserialize(text) {
  try {
    const data = JSON.parse(text);
    if (data?.version !== FORMAT_VERSION || !Array.isArray(data.strokes)) return [];
    return data.strokes.filter(isStroke);
  } catch {
    return [];
  }
}

/** True for a value shaped like a saved stroke. */
export function isStroke(s) {
  return (
    s &&
    (s.tool === "pen" || s.tool === "eraser") &&
    typeof s.color === "string" &&
    typeof s.size === "number" &&
    Array.isArray(s.points) &&
    s.points.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))
  );
}
