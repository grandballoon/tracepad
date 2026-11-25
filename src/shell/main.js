// The shell: holds state, wires the DOM, and runs what the core decides.
// Every decision about playback, ink, captures and layout is in src/core.

import { parseVideo } from "../core/video-id.js";
import { initialTransport, transport, formatTime, formatRate, JUMP_SECONDS } from "../core/transport.js";
import * as Ink from "../core/ink.js";
import { fitFrame, toFramePoint } from "../core/layout.js";
import {
  addCapture,
  removeCapture,
  clockLabel,
  timestampUrl,
  exportNames,
  noteMarkdown,
  serializeCaptures,
  deserializeCaptures,
  setTranscript,
  untranscribed,
} from "../core/captures.js";
import { looksLikeKey } from "../core/transcribe.js";
import { createPlayer } from "./player.js";
import { drawAll, drawStroke, sizeCanvas, renderPng } from "./canvas.js";
import * as store from "./store.js";
import { deliver } from "./export.js";
import { transcribe } from "./claude.js";

// Manim's palette, so traced figures keep the video's colors, plus a dark
// ink for light paper.
const COLORS = [
  { name: "White", value: "#FFFFFF" },
  { name: "Blue", value: "#58C4DD" },
  { name: "Yellow", value: "#FFFF00" },
  { name: "Green", value: "#83C167" },
  { name: "Red", value: "#FC6255" },
  { name: "Ink", value: "#1C1F24" },
];
const PAPER = { dark: "#101215", light: "#ffffff" };
const SIZE_SCALE = 1 / 1000; // slider value is pixels at a 1000-pixel-wide frame

const DEFAULT_SETTINGS = {
  tool: "pen",
  color: COLORS[0].value,
  size: 3,
  inkOpacity: 1,
  videoOpacity: 1,
  paper: "dark",
  pencilOnly: matchMedia("(pointer: coarse)").matches,
  fps: 60,
  transcribe: true,
};

const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULT_SETTINGS };
let tp = initialTransport(settings.fps);
let ink = Ink.emptyInk();
let captures = [];
let video = null; // { id, title }
let player = null;
let started = false;
let mode = "draw";
let frame = { x: 0, y: 0, width: 0, height: 0 };
let ctx = $("ink").getContext("2d");
let activePointer = null;
let prepared = null; // files ready to share, rebuilt when captures change
let claudeKey = ""; // the user's own Anthropic API key, kept only in this browser
const transcribing = new Set(); // capture ids waiting on Claude
const failed = new Map(); // capture id → why Claude couldn't transcribe it

// ---------- playback ----------

function dispatch(command) {
  const result = transport(tp, command);
  tp = result.state;
  if (player) for (const effect of result.effects) player.run(effect);
  renderTransport();
}

function observe() {
  if (!player || !video) return;
  const snap = player.snapshot();
  if (!snap.priming) dispatch({ type: "observe", ...snap });
  if (snap.started && !started) {
    started = true;
    $("hint").hidden = true;
    setMode("draw");
    dispatch({ type: "rates", rates: player.rates() });
  }
  const title = player.title();
  if (title && title !== video.title) {
    video.title = title;
    $("title").textContent = title;
    prepareExport();
  }
}

function renderTransport() {
  $("clock").textContent = formatTime(tp.time, tp.fps);
  $("rate").textContent = formatRate(tp.rate);
  $("play").textContent = tp.playing ? "Pause" : "Play";
}

// ---------- video ----------

async function loadVideo(parsed) {
  if (!player) return toast("The player is still loading. Try again in a moment.", "error");
  video = { id: parsed.id, title: "" };
  started = false;
  $("empty").hidden = true;
  $("hint").hidden = false;
  $("title").textContent = "";
  setMode("video");

  const [savedInk, savedCaptures] = await Promise.all([
    store.get(store.keys.ink(parsed.id)),
    store.get(store.keys.captures(parsed.id)),
  ]);
  if (video?.id !== parsed.id) return; // another video was loaded meanwhile
  ink = Ink.emptyInk(savedInk ? Ink.deserialize(savedInk) : []);
  captures = savedCaptures ? deserializeCaptures(savedCaptures) : [];
  transcribing.clear();
  failed.clear();
  redraw();
  renderInkControls();
  renderCaptures();

  player.load(parsed.id, parsed.start);
  dispatch({ type: "load", start: parsed.start });
  store.set(store.keys.last, parsed.id);
  const url = new URL(location.href);
  url.searchParams.set("v", parsed.id);
  history.replaceState(null, "", url);
}

// ---------- ink ----------

function brush() {
  return { tool: settings.tool, color: settings.color, size: settings.size * SIZE_SCALE };
}

function setInk(next) {
  ink = next;
  redraw();
  renderInkControls();
  saveInk();
}

function redraw() {
  drawAll(ctx, ink.strokes, frame.width, frame.height);
}

function saveInk() {
  if (video) store.set(store.keys.ink(video.id), Ink.serialize(ink.strokes));
}

function pointFrom(event) {
  const r = $("ink").getBoundingClientRect();
  const [x, y] = toFramePoint(event.clientX, event.clientY, { x: r.left, y: r.top, width: r.width, height: r.height });
  return Ink.point(x, y, event.pressure);
}

function onPointerDown(event) {
  if (!video || mode !== "draw" || activePointer !== null) return;
  if (settings.pencilOnly && event.pointerType === "touch") return;
  event.preventDefault();
  activePointer = event.pointerId;
  $("ink").setPointerCapture(event.pointerId);
  ink = Ink.begin(ink, brush(), pointFrom(event));
  drawStroke(ctx, ink.active, frame.width, frame.height, 0);
}

function onPointerMove(event) {
  if (event.pointerId !== activePointer || !ink.active) return;
  const events = event.getCoalescedEvents?.() ?? [];
  const from = ink.active.points.length;
  ink = Ink.extend(ink, (events.length ? events : [event]).map(pointFrom));
  drawStroke(ctx, ink.active, frame.width, frame.height, from);
}

function onPointerEnd(event) {
  if (event.pointerId !== activePointer) return;
  activePointer = null;
  if (event.type === "pointercancel") {
    ink = Ink.cancel(ink);
    redraw();
    return;
  }
  ink = Ink.end(ink);
  renderInkControls();
  saveInk();
}

function renderInkControls() {
  $("undo").disabled = ink.past.length === 0;
  $("redo").disabled = ink.future.length === 0;
  $("clear").disabled = ink.strokes.length === 0;
}

// ---------- captures ----------

function capture() {
  if (!video) return;
  const taken = { id: Date.now(), time: tp.time, strokes: ink.strokes };
  captures = addCapture(captures, taken, tp.fps);
  saveCaptures();
  toast(`Captured ${clockLabel(tp.time)}`);
  if (settings.transcribe && claudeKey) transcribeCapture(taken);
}

// ---------- transcription ----------

async function transcribeCapture(c) {
  if (!video || transcribing.has(c.id)) return;
  const videoId = video.id;
  transcribing.add(c.id);
  failed.delete(c.id);
  renderCaptures();
  let result;
  try {
    const png = await renderPng(c.strokes, PAPER[settings.paper]);
    result = await transcribe({ key: claudeKey, png, title: video.title, time: c.time });
  } catch (error) {
    result = { ok: false, message: error.message };
  }
  if (video?.id !== videoId) return; // another video was loaded meanwhile
  transcribing.delete(c.id);
  if (result.ok) {
    captures = setTranscript(captures, c.id, result.markdown);
    saveCaptures();
  } else {
    failed.set(c.id, result.message);
    renderCaptures();
    toast(result.message, "error");
  }
}

function transcribeWaiting() {
  for (const c of untranscribed(captures)) transcribeCapture(c);
}

function saveCaptures() {
  renderCaptures();
  prepareExport();
  if (video) store.set(store.keys.captures(video.id), serializeCaptures(captures));
}

function renderCaptures() {
  const list = $("captures");
  list.replaceChildren(
    ...captures.map((c, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const state = transcribing.has(c.id) ? "pending" : failed.has(c.id) ? "failed" : typeof c.transcript === "string" ? "done" : "";
      if (state) chip.dataset.state = state;
      const jump = Object.assign(document.createElement("button"), { type: "button", textContent: clockLabel(c.time) });
      jump.title = {
        pending: "Go to this moment. Claude is transcribing it.",
        failed: `Go to this moment. ${failed.get(c.id)}`,
        done: "Go to this moment. Transcribed.",
        "": "Go to this moment",
      }[state];
      jump.addEventListener("click", () => {
        if (tp.playing) dispatch({ type: "togglePlay" });
        dispatch({ type: "jump", seconds: c.time - tp.time });
      });
      const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "×", className: "remove" });
      remove.setAttribute("aria-label", `Remove the capture at ${clockLabel(c.time)}`);
      remove.addEventListener("click", () => {
        captures = removeCapture(captures, i);
        saveCaptures();
      });
      chip.append(jump, remove);
      return chip;
    }),
  );
  const button = $("export");
  button.disabled = captures.length === 0;
  button.textContent = captures.length ? `Export ${captures.length}` : "Export";
  renderClaude();
}

// Files are built ahead of the tap: iPad Safari only opens the share sheet
// when it is called straight from the tap, with no waiting in between.
let prepareToken = 0;
async function prepareExport() {
  const token = ++prepareToken;
  prepared = null;
  if (!video || captures.length === 0) return;
  const meta = { date: new Date(), title: video.title, videoId: video.id };
  const names = exportNames(meta, captures, tp.fps);
  const images = await Promise.all(
    captures.map(async (c, i) => new File([await renderPng(c.strokes, PAPER[settings.paper])], names.images[i], { type: "image/png" })),
  );
  if (token !== prepareToken) return;
  // text/plain: the share sheet refuses some types, and the .md name is what Files keeps.
  const note = new File([noteMarkdown(meta, captures, names.images)], names.note, { type: "text/plain" });
  prepared = [note, ...images];
}

async function exportCaptures() {
  if (transcribing.size) return toast(`Claude is still transcribing ${transcribing.size === 1 ? "a capture" : `${transcribing.size} captures`}. Export when it's done.`);
  if (!prepared) return toast("Getting the export ready. Tap Export again in a moment.");
  const result = await deliver(prepared);
  if (result === "downloaded") toast(`Downloaded ${prepared.length} files.`);
}

async function copyLink() {
  if (!video) return;
  const url = timestampUrl(video.id, tp.time);
  try {
    await navigator.clipboard.writeText(url);
    toast(`Copied a link to ${clockLabel(tp.time)}`);
  } catch {
    toast(url);
  }
}

// ---------- Claude settings ----------

function renderClaude() {
  $("claude").textContent = claudeKey ? "Claude ✓" : "Claude";
  $("claude-key-state").textContent = claudeKey ? "A key is saved in this browser." : "No key saved yet.";
  $("claude-forget").disabled = !claudeKey;
  $("claude-transcribe").checked = settings.transcribe;
  const waiting = untranscribed(captures).filter((c) => !transcribing.has(c.id)).length;
  const run = $("claude-run");
  run.disabled = !claudeKey || waiting === 0;
  run.textContent = waiting ? `Transcribe ${waiting} waiting` : "Nothing waiting";
}

async function saveKey() {
  const input = $("claude-key");
  const value = input.value.trim();
  if (!value) return;
  if (!looksLikeKey(value)) {
    $("claude-key-state").textContent = "That doesn't look like an Anthropic API key. They start with sk-ant-.";
    return;
  }
  input.value = "";
  claudeKey = value;
  await store.set(store.keys.claudeKey, value);
  renderClaude();
}

async function forgetKey() {
  claudeKey = "";
  await store.remove(store.keys.claudeKey);
  renderClaude();
}

// ---------- layout and settings ----------

function layout() {
  const stage = $("stage");
  frame = fitFrame(stage.clientWidth, stage.clientHeight);
  const el = $("frame");
  Object.assign(el.style, {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
  });
  ctx = sizeCanvas($("ink"), frame.width, frame.height);
  redraw();
}

function setMode(next) {
  mode = next;
  $("frame").dataset.mode = next;
  $("mode-draw").setAttribute("aria-pressed", String(next === "draw"));
  $("mode-video").setAttribute("aria-pressed", String(next === "video"));
}

function applySettings() {
  const pressed = (id, on) => $(id).setAttribute("aria-pressed", String(on));
  pressed("tool-pen", settings.tool === "pen");
  pressed("tool-eraser", settings.tool === "eraser");
  pressed("paper-dark", settings.paper === "dark");
  pressed("paper-light", settings.paper === "light");
  for (const swatch of $("swatches").children) pressed(swatch.id, swatch.dataset.color === settings.color);
  $("size").value = settings.size;
  $("ink-opacity").value = settings.inkOpacity;
  $("video-opacity").value = settings.videoOpacity;
  $("pencil-only").checked = settings.pencilOnly;
  $("fps").value = String(settings.fps);
  $("ink").style.opacity = settings.inkOpacity;
  $("video-layer").style.opacity = settings.videoOpacity;
  $("frame").dataset.paper = settings.paper;
}

function updateSettings(patch) {
  const paperChanged = patch.paper && patch.paper !== settings.paper;
  settings = { ...settings, ...patch };
  applySettings();
  store.set(store.keys.settings, settings);
  if (patch.fps) dispatch({ type: "fps", fps: settings.fps });
  if (paperChanged || patch.fps) prepareExport();
}

function buildSwatches() {
  $("swatches").replaceChildren(
    ...COLORS.map((color, i) => {
      const button = Object.assign(document.createElement("button"), { type: "button", id: `swatch-${i}`, className: "swatch" });
      button.dataset.color = color.value;
      button.style.setProperty("--swatch", color.value);
      button.setAttribute("aria-label", color.name);
      button.title = color.name;
      button.addEventListener("click", () => updateSettings({ color: color.value, tool: "pen" }));
      return button;
    }),
  );
}

// ---------- feedback ----------

let toastTimer;
function toast(message, tone = "info") {
  const el = $("toast");
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), tone === "error" ? 5000 : 2200);
}

// ---------- wiring ----------

function bind() {
  const on = (id, fn) => $(id).addEventListener("click", fn);
  on("play", () => dispatch({ type: "togglePlay" }));
  on("back-frame", () => dispatch({ type: "step", frames: -1 }));
  on("fwd-frame", () => dispatch({ type: "step", frames: 1 }));
  on("back-jump", () => dispatch({ type: "jump", seconds: -JUMP_SECONDS }));
  on("fwd-jump", () => dispatch({ type: "jump", seconds: JUMP_SECONDS }));
  on("slower", () => dispatch({ type: "rate", direction: -1 }));
  on("faster", () => dispatch({ type: "rate", direction: 1 }));
  on("mode-draw", () => setMode("draw"));
  on("mode-video", () => setMode("video"));
  on("tool-pen", () => updateSettings({ tool: "pen" }));
  on("tool-eraser", () => updateSettings({ tool: "eraser" }));
  on("paper-dark", () => updateSettings({ paper: "dark" }));
  on("paper-light", () => updateSettings({ paper: "light" }));
  on("undo", () => setInk(Ink.undo(ink)));
  on("redo", () => setInk(Ink.redo(ink)));
  on("clear", () => setInk(Ink.clear(ink)));
  on("capture", capture);
  on("copy-link", copyLink);
  on("export", exportCaptures);
  on("claude", () => {
    renderClaude();
    $("claude-dialog").showModal();
  });
  on("claude-save", saveKey);
  on("claude-forget", forgetKey);
  on("claude-run", transcribeWaiting);
  on("claude-done", () => $("claude-dialog").close());
  $("claude-key").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveKey();
    }
  });
  $("claude-transcribe").addEventListener("change", (e) => updateSettings({ transcribe: e.target.checked }));

  $("fps").addEventListener("change", (e) => updateSettings({ fps: Number(e.target.value) }));
  $("size").addEventListener("input", (e) => updateSettings({ size: Number(e.target.value) }));
  $("ink-opacity").addEventListener("input", (e) => updateSettings({ inkOpacity: Number(e.target.value) }));
  $("video-opacity").addEventListener("input", (e) => updateSettings({ videoOpacity: Number(e.target.value) }));
  $("pencil-only").addEventListener("change", (e) => updateSettings({ pencilOnly: e.target.checked }));

  $("load-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const parsed = parseVideo($("url").value);
    if (!parsed) return toast("That isn't a YouTube link. Paste one like youtu.be/… or youtube.com/watch?v=…", "error");
    $("url").blur();
    loadVideo(parsed);
  });

  const canvas = $("ink");
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);

  document.addEventListener("keydown", onKey);
  new ResizeObserver(layout).observe($("stage"));
}

function onKey(e) {
  if ($("claude-dialog").open) return;
  if (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox") return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "z") {
    e.preventDefault();
    setInk(e.shiftKey ? Ink.redo(ink) : Ink.undo(ink));
    return;
  }
  if (meta || e.altKey) return;
  const actions = {
    " ": () => dispatch({ type: "togglePlay" }),
    k: () => dispatch({ type: "togglePlay" }),
    ",": () => dispatch({ type: "step", frames: -1 }),
    ".": () => dispatch({ type: "step", frames: 1 }),
    j: () => dispatch({ type: "jump", seconds: -JUMP_SECONDS }),
    l: () => dispatch({ type: "jump", seconds: JUMP_SECONDS }),
    "<": () => dispatch({ type: "rate", direction: -1 }),
    ">": () => dispatch({ type: "rate", direction: 1 }),
    p: () => updateSettings({ tool: "pen" }),
    e: () => updateSettings({ tool: "eraser" }),
    c: capture,
  };
  const action = actions[e.key] ?? actions[e.key.toLowerCase()];
  if (!action) return;
  e.preventDefault();
  action();
}

async function main() {
  const saved = await store.get(store.keys.settings);
  settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  claudeKey = (await store.get(store.keys.claudeKey)) ?? "";
  tp = initialTransport(settings.fps);
  buildSwatches();
  applySettings();
  bind();
  layout();
  renderTransport();
  renderInkControls();
  renderCaptures();

  try {
    player = await createPlayer($("player"), {
      onChange: observe,
      onError: (message) => toast(message, "error"),
    });
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  setInterval(observe, 100);

  const fromUrl = new URL(location.href).searchParams.get("v");
  const lastId = fromUrl ?? (await store.get(store.keys.last));
  const parsed = lastId && parseVideo(lastId);
  if (parsed) {
    $("url").value = `https://youtu.be/${parsed.id}`;
    loadVideo(parsed);
  }
}

main();
