// The YouTube player, behind a small interface: run an effect, read a
// snapshot. Everything YouTube-specific lives here.

const API_URL = "https://www.youtube.com/iframe_api";
const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

let apiReady;
function loadApi() {
  apiReady ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement("script");
    script.src = API_URL;
    script.onerror = () => reject(new Error("YouTube's player could not load. Check the connection and reload."));
    document.head.append(script);
  });
  return apiReady;
}

/**
 * @param {HTMLElement} host element the iframe replaces
 * @param {{ onChange: () => void, onError: (message: string) => void }} events
 */
export async function createPlayer(host, events) {
  const YT = await loadApi();
  // A seek on a video that has never played starts it playing. When that
  // happens we let it start, then pause and seek once it is running.
  let pendingSeek = null;

  const player = await new Promise((resolve) => {
    const p = new YT.Player(host, {
      width: "100%",
      height: "100%",
      playerVars: {
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        rel: 0,
        fs: 0,
        iv_load_policy: 3,
        cc_load_policy: 0,
        origin: location.origin,
      },
      events: {
        onReady: () => resolve(p),
        onStateChange: (e) => {
          if (e.data === STATE.PLAYING && pendingSeek !== null) {
            const time = pendingSeek;
            pendingSeek = null;
            p.pauseVideo();
            p.seekTo(time, true);
          }
          events.onChange();
        },
        onPlaybackRateChange: () => events.onChange(),
        onError: (e) => events.onError(describeError(e.data)),
      },
    });
  });

  const neverStarted = () => [STATE.UNSTARTED, STATE.CUED].includes(player.getPlayerState());

  return {
    load(id, start) {
      pendingSeek = null;
      player.cueVideoById({ videoId: id, startSeconds: start });
    },

    /** @param {import("../core/transport.js").Effect} effect */
    run(effect) {
      switch (effect.type) {
        case "play":
          pendingSeek = null;
          player.playVideo();
          break;
        case "pause":
          player.pauseVideo();
          break;
        case "seek":
          if (neverStarted()) {
            pendingSeek = effect.time;
            player.playVideo();
          } else {
            player.seekTo(effect.time, true);
          }
          break;
        case "rate":
          player.setPlaybackRate(effect.rate);
          break;
      }
    },

    /** What the player reports now. `priming` means a deferred seek is in flight. */
    snapshot() {
      const state = player.getPlayerState();
      return {
        time: player.getCurrentTime() || 0,
        duration: player.getDuration() || 0,
        playing: state === STATE.PLAYING || state === STATE.BUFFERING,
        started: !neverStarted(),
        priming: pendingSeek !== null,
        rate: player.getPlaybackRate(),
      };
    },

    rates: () => player.getAvailablePlaybackRates?.() ?? [],
    title: () => player.getVideoData?.()?.title ?? "",
  };
}

function describeError(code) {
  switch (code) {
    case 2:
      return "That doesn't look like a valid YouTube video.";
    case 5:
      return "This video can't play in an embedded player.";
    case 100:
      return "This video was removed or made private.";
    case 101:
    case 150:
    case 153:
      return "The video's owner doesn't allow it to play outside YouTube.";
    default:
      return `YouTube reported error ${code}.`;
  }
}
