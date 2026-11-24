// Drawing strokes onto a 2D canvas. Points are normalized to the frame;
// `width` and `height` are the frame size in CSS pixels.

import { lineWidth } from "../core/ink.js";

/** @param {CanvasRenderingContext2D} ctx @param {import("../core/ink.js").Stroke[]} strokes */
export function drawAll(ctx, strokes, width, height) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  for (const stroke of strokes) drawStroke(ctx, stroke, width, height, 0);
}

/**
 * Draw a stroke from point `from` on, so a live stroke can be drawn as it
 * grows without redrawing what is already on the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../core/ink.js").Stroke} stroke
 */
export function drawStroke(ctx, stroke, width, height, from) {
  const { points } = stroke;
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (points.length === 1) {
    const [x, y, p] = points[0];
    ctx.beginPath();
    ctx.arc(x * width, y * height, lineWidth(stroke.size, p, width) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = Math.max(1, from); i < points.length; i++) {
    const [x0, y0, p0] = points[i - 1];
    const [x1, y1, p1] = points[i];
    ctx.lineWidth = lineWidth(stroke.size, (p0 + p1) / 2, width);
    ctx.beginPath();
    ctx.moveTo(x0 * width, y0 * height);
    ctx.lineTo(x1 * width, y1 * height);
    ctx.stroke();
  }
  ctx.restore();
}

/** Size a canvas to a frame at the screen's pixel density. */
export function sizeCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** A capture as a PNG: the ink over the paper color, at 1920×1080. */
export function renderPng(strokes, paper) {
  const width = 1920;
  const height = 1080;
  const ink = document.createElement("canvas");
  ink.width = width;
  ink.height = height;
  drawAll(ink.getContext("2d"), strokes, width, height);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(ink, 0, 0);
  return new Promise((resolve, reject) =>
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image could not be made."))), "image/png"),
  );
}
