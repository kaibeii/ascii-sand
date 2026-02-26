import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export type Vec3 = { x: number; y: number; z: number };

export type HandWindConfig = {
  maxWind: number;  // clamp raw velocity magnitude
  smooth: number;   // lerp factor for smoothing
};
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clampMagnitude(v: Vec3, maxMag: number): Vec3 {
  const mag = Math.hypot(v.x, v.y, v.z);
  if (mag <= maxMag || mag === 0) return v;
  const s = maxMag / mag;
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export class HandWind {
  private video: HTMLVideoElement;
  private cfg: HandWindConfig;

  private landmarker: HandLandmarker | null = null;
  private running = false;
private lastHand2D: { x: number; y: number }[] | null = null;

getLastHand2D() {
  return this.lastHand2D;
}
private lastTip: Vec3 | null = null;
private wind: Vec3 = { x: 0, y: 0, z: 0 };

  private lastT = 0;
  // normalized spread (0 = fingers together / narrow, 1 = fingers far apart / wide)
  private lastSpread = 1;
  // last known pointer X (normalized 0..1)
  private lastPointerX = 0.5;
  // auto-calibrated maximum finger distance
  private maxObservedDist = 0.08;

  constructor(video: HTMLVideoElement, cfg: HandWindConfig) {
    this.video = video;
    this.cfg = cfg;
  }

  isRunning() {
    return this.running;
  }

getWind(): Vec3 {
  return this.wind;
}

  async start() {
    if (this.running) return;

    // Start webcam stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    // Load MediaPipe tasks
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });

    this.running = true;
    this.lastTip = null;
     this.wind = { x: 0, y: 0, z:0 };

    this.lastT = performance.now();

    this.detectLoop();
  }

  async stop() {
    this.running = false;

    if (this.video.srcObject) {
      const tracks = (this.video.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      this.video.srcObject = null;
    }
    this.lastTip = null;
    this.wind = { x: 0, y: 0, z:0 };
    this.lastSpread = 1;
    this.lastPointerX = 0.5;
  }

  private detectLoop = () => {
    if (!this.running || !this.landmarker) return;

    const now = performance.now();
    const dt = Math.max(1, now - this.lastT); // ms
    this.lastT = now;

    const res = this.landmarker.detectForVideo(this.video, now);
    const hand = res.landmarks?.[0];
    this.lastHand2D = hand ? hand.map(p => ({ x: p.x, y: p.y })) : null;

    // Index fingertip is landmark 8
    const lm = res.landmarks?.[0]?.[8];
    // middle fingertip is landmark 12
    const mid = res.landmarks?.[0]?.[12];
    if (lm) {
      // Convert normalized coords to pseudo "screen-space"
      // (we'll treat it as 0..1 then scale later)
     const tip: Vec3 = { x: lm.x, y: lm.y, z: lm.z };

      // update pointer X directly (no smoothing here; smoothing can be
      // applied downstream). clamp to 0..1
      this.lastPointerX = Math.max(0, Math.min(1, lm.x));

      if (this.lastTip) {
       const vx = (tip.x - this.lastTip.x) * 1000 / dt;

        const vz = (tip.z - this.lastTip.z) * 1000 / dt;

        // We only really want X (left/right) and Z (depth).
        // We'll keep y as 0 so up/down does nothing.
        const raw: Vec3 = { x: vx, y: 0, z: vz };

        const clamped = clampMagnitude(raw, this.cfg.maxWind);
        // Smooth
       this.wind = {
        x: lerp(this.wind.x, clamped.x, this.cfg.smooth),
        y: lerp(this.wind.y, clamped.y, this.cfg.smooth),
        z: lerp(this.wind.z, clamped.z, this.cfg.smooth),
        };
          // compute spread (distance between index tip and middle tip) if available
          if (mid) {
            const dx = lm.x - mid.x;
            const dy = lm.y - mid.y;
            const rawDist = Math.hypot(dx, dy);

            // --- stable auto-calibration (prevents snapping) ---
            const targetMax = Math.max(this.maxObservedDist, rawDist);
            this.maxObservedDist = lerp(this.maxObservedDist, targetMax, 0.05);

            // --- more forgiving mapping ---
            const minD = 0.035; // raise this to make "closed" harder to reach
            const maxD = Math.max(0.12, this.maxObservedDist); // floor prevents hypersensitivity

            let spread = (rawDist - minD) / (maxD - minD);
            spread = Math.max(0, Math.min(1, spread));

            // --- soften response curve (stay wider longer) ---
            spread = Math.pow(spread, 0.6);

            // smooth output
            this.lastSpread = lerp(this.lastSpread, spread, this.cfg.smooth);
          }
      }
      this.lastTip = tip;
    } else {
      // If no hand, decay wind toward zero
      this.wind = { x: this.wind.x * 0.9, y: this.wind.y * 0.9, z: this.wind.z * 0.9 };
      this.lastSpread = this.lastSpread * 0.9 + 0.1; // slowly return to wide
      this.lastTip = null;
    }

    requestAnimationFrame(this.detectLoop);
  };

  getSpread() {
    return this.lastSpread;
  }

  getPointerX() {
    return this.lastPointerX;
  }
}