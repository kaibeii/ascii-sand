import "./style.css";
import { HandWind } from "./wind/handWind";
import type { HandWindConfig } from "./wind/handWind";
import { Game } from "./wind/game";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const video = document.querySelector<HTMLVideoElement>("#webcam")!;
const btnStart = document.querySelector<HTMLButtonElement>("#btnStart")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btnStop")!;
const sens = document.querySelector<HTMLInputElement>("#sens")!;
const debug = document.querySelector<HTMLInputElement>("#debug")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;

const overlay = document.querySelector<HTMLCanvasElement>("#handOverlay")!;
const overlayCtx: CanvasRenderingContext2D = (() => {
  const ctx = overlay.getContext("2d");
  if (!ctx) throw new Error("No 2D context for #handOverlay");
  return ctx;
})();

// Make canvas crisp (DPR-aware)
function resizeCanvasToDisplaySize(c: HTMLCanvasElement) {
  const rect = c.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

const game = new Game(canvas);

const windCfg: HandWindConfig = {
  maxWind: 20,
  smooth: 0.18,
};

const handWind = new HandWind(video, windCfg);

function drawHandOverlay() {
  resizeCanvasToDisplaySize(overlay);
  const w = overlay.width;
  const h = overlay.height;

  overlayCtx.clearRect(0, 0, w, h);

  // HandWind must expose getLastHand2D() for this to work
  const hand2d =
    (handWind as any).getLastHand2D && typeof (handWind as any).getLastHand2D === "function"
      ? (handWind as any).getLastHand2D()
      : null;

  if (!hand2d || !hand2d.length) return;

  overlayCtx.save();

  // draw points (mirror X to match CSS-mirrored video)
  overlayCtx.globalAlpha = 0.92;
  overlayCtx.fillStyle = "#e8eef5";

  for (let i = 0; i < hand2d.length; i++) {
    const p = hand2d[i];
    const x = (1 - p.x) * w; // mirror to match video transform scaleX(-1)
    const y = p.y * h;

    const r = i === 8 || i === 12 ? 6 : 3;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, r, 0, Math.PI * 2);
    overlayCtx.fill();
  }

  // optional: aim line based on pointerX (also mirrored)
  const pointerX =
    (handWind as any).getPointerX && typeof (handWind as any).getPointerX === "function"
      ? (handWind as any).getPointerX()
      : 0.5;

  overlayCtx.globalAlpha = 0.5;
  overlayCtx.strokeStyle = "#e8eef5";
  overlayCtx.lineWidth = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const aimX = (1 - pointerX) * w;
  overlayCtx.beginPath();
  overlayCtx.moveTo(aimX, 0);
  overlayCtx.lineTo(aimX, h);
  overlayCtx.stroke();

  overlayCtx.restore();
}

function loop() {
  resizeCanvasToDisplaySize(canvas);

  const sensitivity = Number(sens.value);

  const wind = handWind.getWind();
  game.setDebug(debug.checked);

  const spread =
    (handWind as any).getSpread && typeof (handWind as any).getSpread === "function"
      ? (handWind as any).getSpread()
      : 1;

  const pointerX =
    (handWind as any).getPointerX && typeof (handWind as any).getPointerX === "function"
      ? (handWind as any).getPointerX()
      : 0.5;

  // Invert pointerX so left hand movement produces left sand movement
  game.setWind(wind.x * sensitivity, wind.z * sensitivity, spread, 1 - pointerX);

  game.tick();

  // Draw the tracking overlay on the preview
  drawHandOverlay();

  statusEl.textContent = handWind.isRunning()
    ? `Wind: (${(wind.x * sensitivity).toFixed(2)}, ${(wind.z * sensitivity).toFixed(
        2
      )}) spread:${spread.toFixed(2)} px:${pointerX.toFixed(2)}`
    : `Camera stopped`;

  requestAnimationFrame(loop);
}

loop();


btnStart.onclick = async () => {
  btnStart.disabled = true;
  try {
    await handWind.start();
    btnStop.disabled = false;
  } catch (e) {
    console.error(e);
    btnStart.disabled = false;
    statusEl.textContent = `Failed to start camera (check permissions).`;
  }
};

btnStop.onclick = async () => {
  btnStop.disabled = true;
  await handWind.stop();
  btnStart.disabled = false;
};


window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const next = !game.isPaused();
    game.setPaused(next);

    statusEl.textContent = next
      ? "Paused — press Esc to resume"
      : "Running";
  }
});
