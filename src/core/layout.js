// Where the video frame sits inside the stage: as large as fits, centered,
// at the video's aspect ratio. The ink canvas covers exactly this rectangle.

export const VIDEO_ASPECT = 16 / 9;

/** @returns {{ x: number, y: number, width: number, height: number }} whole pixels */
export function fitFrame(stageWidth, stageHeight, aspect = VIDEO_ASPECT) {
  if (stageWidth <= 0 || stageHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const width = Math.floor(Math.min(stageWidth, stageHeight * aspect));
  const height = Math.floor(width / aspect);
  return {
    x: Math.floor((stageWidth - width) / 2),
    y: Math.floor((stageHeight - height) / 2),
    width,
    height,
  };
}

/** A pointer position to a normalized point in a frame rectangle (both in the same pixels). */
export function toFramePoint(px, py, frame) {
  return [(px - frame.x) / frame.width, (py - frame.y) / frame.height];
}
