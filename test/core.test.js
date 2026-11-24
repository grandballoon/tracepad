import { test } from "node:test";
import assert from "node:assert/strict";

import { parseVideo, parseStart } from "../src/core/video-id.js";
import {
  initialTransport,
  transport,
  frameAt,
  frameTime,
  stepRate,
  formatTime,
  formatRate,
  RATES,
} from "../src/core/transport.js";
import * as ink from "../src/core/ink.js";
import { fitFrame, toFramePoint } from "../src/core/layout.js";
import {
  addCapture,
  removeCapture,
  timestampUrl,
  clockLabel,
  slugify,
  exportNames,
  noteMarkdown,
  serializeCaptures,
  deserializeCaptures,
} from "../src/core/captures.js";

const ID = "fNk_zzaMoSs";

test("parseVideo reads every common YouTube link shape", () => {
  const cases = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `youtube.com/watch?v=${ID}&list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ];
  for (const input of cases) assert.deepEqual(parseVideo(input), { id: ID, start: 0 }, input);
});

test("parseVideo keeps the start time", () => {
  assert.deepEqual(parseVideo(`https://youtu.be/${ID}?t=95`), { id: ID, start: 95 });
  assert.deepEqual(parseVideo(`https://www.youtube.com/watch?v=${ID}&t=1m35s`), { id: ID, start: 95 });
});

test("parseVideo rejects what is not a video", () => {
  for (const input of ["", "hello", "https://vimeo.com/123", "https://youtube.com/watch?v=short", "https://youtube.com/"]) {
    assert.equal(parseVideo(input), null, input);
  }
});

test("parseStart reads plain seconds and h/m/s forms", () => {
  assert.equal(parseStart("90"), 90);
  assert.equal(parseStart("90s"), 90);
  assert.equal(parseStart("1h2m3s"), 3723);
  assert.equal(parseStart(null), 0);
  assert.equal(parseStart("soon"), 0);
});

test("frame math lands in the middle of a frame and reads it back", () => {
  assert.equal(frameAt(frameTime(120, 60), 60), 120);
  assert.equal(frameAt(2, 60), 120);
  assert.equal(frameAt(-1, 60), 0);
});

test("stepping a frame pauses a playing video and seeks", () => {
  const playing = { ...initialTransport(60), playing: true, time: 2, duration: 100 };
  const { state, effects } = transport(playing, { type: "step", frames: 1 });
  assert.equal(state.playing, false);
  assert.equal(frameAt(state.time, 60), 121);
  assert.deepEqual(effects, [{ type: "pause" }, { type: "seek", time: state.time }]);
});

test("repeated steps build on the last target, not on a stale player clock", () => {
  let state = { ...initialTransport(60), time: frameTime(10, 60), duration: 100 };
  for (let i = 0; i < 3; i++) {
    state = transport(state, { type: "step", frames: 1 }).state;
    // The player reports a lagging time while paused; it must be ignored.
    state = transport(state, { type: "observe", time: frameTime(10, 60), playing: false, duration: 100 }).state;
  }
  assert.equal(frameAt(state.time, 60), 13);
});

test("stepping back stops at the first frame", () => {
  const { state } = transport({ ...initialTransport(30), time: 0 }, { type: "step", frames: -1 });
  assert.equal(frameAt(state.time, 30), 0);
});

test("jumps clamp to the video", () => {
  const start = { ...initialTransport(), time: 5, duration: 12 };
  assert.deepEqual(transport(start, { type: "jump", seconds: -10 }).effects, [{ type: "seek", time: 0 }]);
  assert.deepEqual(transport(start, { type: "jump", seconds: 10 }).effects, [{ type: "seek", time: 12 }]);
});

test("toggling play emits play then pause", () => {
  const a = transport(initialTransport(), { type: "togglePlay" });
  assert.deepEqual(a.effects, [{ type: "play" }]);
  const b = transport(a.state, { type: "togglePlay" });
  assert.deepEqual(b.effects, [{ type: "pause" }]);
});

test("the player clock is trusted while playing and at the moment it stops", () => {
  const playing = { ...initialTransport(), playing: true, time: 1 };
  assert.equal(transport(playing, { type: "observe", time: 4, playing: true, duration: 50 }).state.time, 4);
  const stopped = transport(playing, { type: "observe", time: 4.2, playing: false, duration: 50 }).state;
  assert.equal(stopped.time, 4.2);
  assert.equal(stopped.duration, 50);
});

test("the player's actual rate wins over the requested one", () => {
  const state = transport({ ...initialTransport(), rate: 2 }, { type: "observe", time: 0, playing: false, duration: 0, rate: 1.5 }).state;
  assert.equal(state.rate, 1.5);
});

test("rate steps through the player's available rates and stops at the ends", () => {
  assert.equal(stepRate(1, 1), 1.25);
  assert.equal(stepRate(1, -1), 0.75);
  assert.equal(stepRate(2, 1), 2);
  assert.equal(stepRate(0.25, -1), 0.25);
  const narrow = transport(initialTransport(), { type: "rates", rates: [1, 0.5, 2] }).state;
  assert.deepEqual(transport(narrow, { type: "rate", direction: -1 }).effects, [{ type: "rate", rate: 0.5 }]);
  assert.deepEqual(transport({ ...narrow, rate: 2 }, { type: "rate", direction: 1 }).effects, []);
  assert.deepEqual(RATES[0], 0.25);
});

test("readouts", () => {
  assert.equal(formatTime(65 + 23.5 / 60, 60), "1:05.23");
  assert.equal(formatTime(0, 24), "0:00.00");
  assert.equal(formatTime(9.99, 30), "0:09.29");
  assert.equal(formatRate(0.25), "0.25×");
  assert.equal(formatRate(1), "1×");
});

const brush = { tool: "pen", color: "#fff", size: 0.004 };

test("a stroke commits on end and undo/redo walk the history", () => {
  let s = ink.emptyInk();
  s = ink.begin(s, brush, [0.1, 0.1, 0.5]);
  s = ink.extend(s, [[0.2, 0.2, 0.6]]);
  s = ink.end(s);
  assert.equal(s.strokes.length, 1);
  assert.deepEqual(s.strokes[0].points, [[0.1, 0.1, 0.5], [0.2, 0.2, 0.6]]);
  s = ink.undo(s);
  assert.deepEqual(s.strokes, []);
  s = ink.redo(s);
  assert.equal(s.strokes.length, 1);
});

test("clear is undoable and a new stroke drops the redo branch", () => {
  let s = ink.end(ink.begin(ink.emptyInk(), brush, [0, 0, 1]));
  s = ink.clear(s);
  assert.deepEqual(s.strokes, []);
  s = ink.undo(s);
  assert.equal(s.strokes.length, 1);
  s = ink.undo(s);
  s = ink.end(ink.begin(s, brush, [0.5, 0.5, 1]));
  assert.deepEqual(s.future, []);
});

test("points round to a visible precision", () => {
  assert.deepEqual(ink.point(0.123456, 0.987654, 0.33333), [0.1235, 0.9877, 0.33]);
});

test("clearing an empty drawing adds no history", () => {
  assert.deepEqual(ink.clear(ink.emptyInk()).past, []);
});

test("line width follows pressure but never vanishes", () => {
  assert.equal(ink.lineWidth(0.01, 1, 1000), 10);
  assert.equal(ink.lineWidth(0.01, 0.5, 1000), 10); // no pressure reported
  assert.ok(Math.abs(ink.lineWidth(0.01, 0.1, 1000) - 4) < 1e-9);
});

test("strokes survive a save and bad saves read as empty", () => {
  const strokes = [{ ...brush, points: [[0, 0, 1]] }];
  assert.deepEqual(ink.deserialize(ink.serialize(strokes)), strokes);
  assert.deepEqual(ink.deserialize("not json"), []);
  assert.deepEqual(ink.deserialize(JSON.stringify({ version: 99, strokes })), []);
  assert.deepEqual(ink.deserialize(JSON.stringify({ version: 1, strokes: [{ tool: "laser" }] })), []);
});

test("the frame fills the stage at 16:9 and centers", () => {
  assert.deepEqual(fitFrame(1600, 1000), { x: 0, y: 50, width: 1600, height: 900 });
  assert.deepEqual(fitFrame(1000, 400), { x: 144, y: 0, width: 711, height: 399 });
  assert.deepEqual(fitFrame(0, 400), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(toFramePoint(800, 500, { x: 0, y: 50, width: 1600, height: 900 }), [0.5, 0.5]);
});

test("captures keep time order and replace one at the same frame", () => {
  let list = addCapture([], { time: 10, strokes: [] }, 60);
  list = addCapture(list, { time: 3, strokes: [] }, 60);
  list = addCapture(list, { time: 10.001, strokes: [brush] }, 60);
  assert.deepEqual(list.map((c) => c.time), [3, 10.001]);
  assert.deepEqual(removeCapture(list, 0).map((c) => c.time), [10.001]);
});

test("timestamp links and labels", () => {
  assert.equal(timestampUrl(ID, 65.9), `https://youtu.be/${ID}?t=65`);
  assert.equal(timestampUrl(ID, 0.4), `https://youtu.be/${ID}`);
  assert.equal(clockLabel(65.9), "1:05");
  assert.equal(clockLabel(3725), "1:02:05");
});

test("slugify makes safe file names", () => {
  assert.equal(slugify("Vectors, what even are they? | Chapter 1"), "vectors-what-even-are-they-chapter-1");
  assert.equal(slugify("Café ½"), "cafe-1-2");
  assert.equal(slugify("???"), "video");
});

test("export names and note", () => {
  const meta = { date: new Date(2026, 10, 24), title: "Linear transformations", videoId: ID };
  const captures = [{ time: 1, strokes: [] }, { time: 65.5, strokes: [] }];
  const names = exportNames(meta, captures, 60);
  assert.deepEqual(names, {
    note: "2026-11-24-linear-transformations.md",
    images: ["2026-11-24-linear-transformations-000060.png", "2026-11-24-linear-transformations-003930.png"],
  });
  assert.equal(
    noteMarkdown(meta, captures, names.images),
    [
      "---",
      'title: "Linear transformations"',
      `url: "https://www.youtube.com/watch?v=${ID}"`,
      "date: 2026-11-24",
      "source: media",
      "tags: [tracepad]",
      "---",
      "",
      "# Linear transformations",
      "",
      `## [0:01](https://youtu.be/${ID}?t=1)`,
      "",
      "![[2026-11-24-linear-transformations-000060.png]]",
      "",
      `## [1:05](https://youtu.be/${ID}?t=65)`,
      "",
      "![[2026-11-24-linear-transformations-003930.png]]",
      "",
    ].join("\n"),
  );
});

test("captures survive a save and bad saves read as empty", () => {
  const captures = [{ time: 4, strokes: [{ ...brush, points: [[0, 0, 1]] }] }];
  assert.deepEqual(deserializeCaptures(serializeCaptures(captures)), captures);
  assert.deepEqual(deserializeCaptures("{"), []);
  assert.deepEqual(deserializeCaptures(JSON.stringify({ version: 1, captures: [{ time: "x" }] })), []);
});
