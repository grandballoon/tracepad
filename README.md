# Tracepad

Draw over a YouTube video on iPad with Apple Pencil, step through it frame by frame, and capture moments as Obsidian notes.

## Using it

Paste a YouTube link and tap **Load**.
Tap the video once to start it; drawing turns on as soon as it plays.
iOS only lets a video start from a tap on the video itself, which is why the first tap goes to YouTube.
Switch **Draw / Video** in the top bar whenever you want touches to reach the YouTube player again.

With **Pencil only** on (the default on touch screens), fingers and palms never draw.
**Ink** sets the drawing's opacity, **Video** fades the video toward the paper, and **Dark / Light** picks the paper.
Fade the video to zero to see your drawing on its own.
The drawing is saved in the browser for each video and comes back when you load that video again.

| Key | Action |
| --- | --- |
| Space or K | Play or pause |
| , and . | Back or forward one frame |
| J and L | Back or forward 10 seconds |
| < and > | Slower or faster |
| P and E | Pen or eraser |
| C | Capture this moment |
| ⌘Z and ⇧⌘Z | Undo and redo |

Frame steps assume the frame rate in the **fps** menu (3Blue1Brown uploads are 60).

## Notes for Obsidian

**Capture** records the current moment with the drawing as it stands.
**Export** builds one Markdown note with a timestamp link per capture and one PNG of the drawing per capture, then opens the share sheet.
On iPad, choose **Save to Files** and pick the vault folder you want them in.
The note embeds each image with `![[...]]`, so keep the images beside the note or anywhere in the vault.
**Copy link** copies a link that opens the video at the current moment.

The page cannot capture video frames.
Browsers do not let a page read the pixels of another site's player.
For a frame with your drawing on it, take an iPad screenshot (swipe up from a bottom corner with Apple Pencil).

## Design

The code is a functional core with an imperative shell.

- `src/core/` holds every decision as pure functions over values, tested with `node:test`.
  `transport.js` turns playback commands into effects, `ink.js` is the drawing and its undo history, `captures.js` builds the export, `layout.js` fits the frame and `video-id.js` reads links.
- `src/shell/` holds state and does the I/O: the YouTube player, the canvas, IndexedDB storage and the share sheet.
  `main.js` wires them together.

Ink points are stored normalized to the video frame, so drawings stay registered to the video at any screen size.

## Development

No build step and no dependencies.
Node 22 runs the tests.

```bash
npm test
```

```bash
npm run serve
```

Then open http://localhost:8642.
YouTube's player needs the page served over http or https, not opened as a file.
