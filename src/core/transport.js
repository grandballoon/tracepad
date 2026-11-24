// Playback decisions. The shell feeds in commands and what the player
// reports; this returns the next state plus effects for the shell to run.
//
// While paused, the core's `time` is the authority: frame steps build on the
// last target rather than on the player's clock, which lags behind a seek.

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const JUMP_SECONDS = 10;

/** @typedef {{ time: number, duration: number, playing: boolean, rate: number, fps: number, rates: number[] }} Transport */
/** @typedef {{ type: "play" } | { type: "pause" } | { type: "seek", time: number } | { type: "rate", rate: number }} Effect */

/** @returns {Transport} */
export function initialTransport(fps = 60) {
  return { time: 0, duration: 0, playing: false, rate: 1, fps, rates: RATES };
}

/**
 * @param {Transport} state
 * @param {{ type: string, [key: string]: any }} command
 * @returns {{ state: Transport, effects: Effect[] }}
 */
export function transport(state, command) {
  switch (command.type) {
    case "togglePlay":
      return state.playing
        ? { state: { ...state, playing: false }, effects: [{ type: "pause" }] }
        : { state: { ...state, playing: true }, effects: [{ type: "play" }] };

    case "step": {
      const time = clampTime(frameTime(frameAt(state.time, state.fps) + command.frames, state.fps), state.duration);
      const effects = state.playing ? [{ type: "pause" }] : [];
      return { state: { ...state, playing: false, time }, effects: [...effects, { type: "seek", time }] };
    }

    case "jump": {
      const time = clampTime(state.time + command.seconds, state.duration);
      return { state: { ...state, time }, effects: [{ type: "seek", time }] };
    }

    case "rate": {
      const rate = stepRate(state.rate, command.direction, state.rates);
      if (rate === state.rate) return { state, effects: [] };
      return { state: { ...state, rate }, effects: [{ type: "rate", rate }] };
    }

    case "fps":
      return { state: { ...state, fps: command.fps }, effects: [] };

    case "rates": {
      const rates = command.rates?.length ? [...command.rates].sort((a, b) => a - b) : RATES;
      return { state: { ...state, rates }, effects: [] };
    }

    case "observe": {
      // Accept the player's clock while it runs, or at the moment it stops.
      const trustClock = command.playing || state.playing;
      return {
        state: {
          ...state,
          playing: command.playing,
          duration: command.duration > 0 ? command.duration : state.duration,
          time: trustClock ? command.time : state.time,
          rate: command.rate > 0 ? command.rate : state.rate,
        },
        effects: [],
      };
    }

    case "load":
      return {
        state: { ...state, time: command.start ?? 0, duration: 0, playing: false },
        effects: [],
      };

    default:
      return { state, effects: [] };
  }
}

/** Which frame a time falls in. The epsilon absorbs float noise from seeks. */
export function frameAt(time, fps) {
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

/** Aim for the middle of a frame so rounding in the player cannot miss it. */
export function frameTime(frame, fps) {
  return (Math.max(0, frame) + 0.5) / fps;
}

export function clampTime(time, duration) {
  const upper = duration > 0 ? duration : Infinity;
  return Math.min(Math.max(0, time), upper);
}

/** Next available rate in a direction (+1 faster, -1 slower), stopping at the ends. */
export function stepRate(rate, direction, rates = RATES) {
  if (direction > 0) return rates.find((r) => r > rate + 1e-9) ?? rate;
  return [...rates].reverse().find((r) => r < rate - 1e-9) ?? rate;
}

/** "1:05.23" style readout: minutes, seconds, and the frame within the second. */
export function formatTime(time, fps) {
  const frame = frameAt(time, fps);
  const totalSeconds = Math.floor(frame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const sub = frame - totalSeconds * fps;
  const subDigits = String(fps - 1).length;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(sub).padStart(subDigits, "0")}`;
}

export function formatRate(rate) {
  return `${Number(rate.toFixed(2))}×`;
}
