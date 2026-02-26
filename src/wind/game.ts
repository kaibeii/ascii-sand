

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

type Particle = {
  // World space (first-person lane)
  x: number;   // left/right
  z: number;   // forward depth
  vx: number;
  vz: number;
  life: number;
  ch: string;

  // cached projection/style for smooth rendering
  screenX?: number;
  screenY?: number;
  size?: number;
};

// avoid reallocating the char set on every spawn
const PARTICLE_CHARS = [".", ":", "*"];  // used by spawnParticle

type Enemy = {
  x: number;
  z: number;
  r: number;     // radius in world units
  hp: number;
  flash: number;
};

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
private zFar = 220; // how far the lane goes; tune 150–400
  // Wind now acts in world x/z (not x/y)
  private windXZ: { x: number; z: number } = { x: 0, z: 0 };
  private debug = false;

  // pump smoothing state (helps avoid jittery depth pushes)
  private lastPump = 0;

  // current finger spread (0..1) from HandWind
  private spread = 1;
  // current pointer X normalized (0..1)
  private pointerX = 0.5;

  private particles: Particle[] = [];
  
  // define lane half‑width in world units; used for physics and grid lines
  private laneEdge = 10;  // kept in one place so grid and particles align
  private enemy: Enemy = { x: 0, z: 22, r: 1.4, hp: 30, flash: 0 };
  private score = 0;

  // Camera-ish render constants (feel knobs)
  private horizonPct = 0.2; // where horizon sits (0..1 from top)
  private fov = 20;          // bigger = stronger perspective
  private zNear = 2.0;       // prevents blow-up close to camera
  private xScale = 100;       // scales lateral spread on screen
  private floorSpanPct = 0.4;

  private enemyFace() {
    const e = this.enemy;

    // hit flash: angry face
    if (e.flash > 0) return "(ಠ益ಠ)";

    // low HP: dying face
    if (e.hp < 10) return "(x_x)";

    // default hostile stare
    return "(ಠ_ಠ)";
  }

 private enemyHitRadiusWorld() {
  const e = this.enemy;

  // same projection + sizing logic you use in render()
  const es = this.project(e.x, e.z);
  const baseFont = 16;

  const enemySizePx = Math.max(12, Math.min(28, Math.round(baseFont * (0.7 + es.p * 0.9))));

  // approximate face width in pixels (monospace char width ~0.6 * font size)
  const face = this.enemyFace();
  const charCount = Array.from(face).length;
  const faceWidthPx = charCount * enemySizePx * 0.6;

  // desired hit radius in pixels (half the width, slightly shrunk)
  const hitRadiusPx = (faceWidthPx * 0.5) * 0.55; // tweak 0.45–0.7 to taste

  // convert px radius → world radius using xScale mapping
  const pxPerWorldX = es.p * this.xScale;
  const rWorld = hitRadiusPx / Math.max(1e-6, pxPerWorldX);

  return rWorld;
}

private paused = false;

setPaused(v: boolean) {
  this.paused = v;
}

isPaused() {
  return this.paused;
}

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    this.ctx = ctx;
  }

  setDebug(v: boolean) {
    this.debug = v;
  }

  // IMPORTANT: setWind now expects screen-ish wx/wy and maps them to world x/z
  // Right hand motion -> push right. Up motion -> push forward (depth).
setWind(wx: number, wz: number, spread = 1, pointerX = 0.5) {
  const kx = 0.020;
  const kz = 0.06; // boost depth gain for more noticeable pumping

  const windX = -wx;

  // ---- Pumping depth: use SPEED (wz), with smaller deadzone + gentler curve ----
  let pump = -wz; // invert if forward/backwards feels wrong

  // smaller deadzone so light pumps still register
  const dz = 0.08;
  if (Math.abs(pump) < dz) pump = 0;
  else pump = Math.sign(pump) * (Math.abs(pump) - dz);

  // gentle exponent to keep moderate pumps strong; avoids crushing small values
  pump = Math.sign(pump) * Math.pow(Math.abs(pump), 1.3);

  // simple clamping
  const pumpMax = 4.0;
  pump = Math.max(-pumpMax, Math.min(pumpMax, pump));

  // reduce backward (negative) pumps so pulling has much less effect
  if (pump < 0) pump *= 0.25;

  // smooth the value across frames to reduce jitter
  this.lastPump += (pump - this.lastPump) * 0.3;
  pump = this.lastPump;
  this.windXZ = { x: windX * kx, z: pump * kz };

  // store spread from controller
  this.spread = Math.max(0, Math.min(1, spread));
  this.pointerX = Math.max(0, Math.min(1, pointerX));
}

  tick() {
   if (this.paused) {
    // still render so the screen doesn’t freeze visually
    this.render(this.canvas.width, this.canvas.height);
    return;
  }
  

    const w = this.canvas.width;
    const h = this.canvas.height;
    this.enemy.z -= 0.002;
    this.enemy.z = Math.max(14, this.enemy.z);  
    // Spawn particles near the camera (small z), so you "blow" them forward
    // spawn a few new particles each tick; count is constant so we can
    // make it a file‑level constant if desired.
    for (let i = 0; i < 6; i++) this.spawnParticle();

    // Physics update
    const drag = 0.985;

    for (const p of this.particles) {
      // Wind acceleration in world x/z
      p.vx += this.windXZ.x;
      p.vz += this.windXZ.z;

     
      p.vz += 0.002;

      p.vx *= drag;
      p.vz *= drag;

      p.x += p.vx;
      p.z += p.vz;
      // steer particles toward the pointer position only when fingers are close together
      // When spread is high (fingers apart), particles drift freely
      const s = this.project(p.x, p.z);
      const screenTargetX = this.pointerX * w;
      const screenDelta = screenTargetX - s.screenX;
      const worldDelta = screenDelta / (s.p * this.xScale);
      
      // Only apply steering when spread is low (fingers close)
      if (this.spread < 0.5) {
        const pullStrength = (1 - this.spread) * 0.5;
        if (Math.abs(worldDelta) > 1e-5 && pullStrength > 1e-4) {
          const desiredVx = worldDelta * pullStrength;
          const steerAlpha = 0.22;
          p.vx = p.vx * (1 - steerAlpha) + desiredVx * steerAlpha;
        }
      }
      // clamp lateral speed to avoid flip/overshoot
      const maxLateral = 0.9;
      if (p.vx > maxLateral) p.vx = maxLateral;
      if (p.vx < -maxLateral) p.vx = -maxLateral;
      // heavy lateral damping when spread is very small to avoid bouncing
      if (this.spread < 0.18) {
        p.vx *= 0.08;
      }
      // If it goes far down the lane, recycle it back near the camera
      
        if (p.z > this.zFar) {
        p.z = rand(2.0, 6.0);
        p.x = rand(-this.laneEdge + 2, this.laneEdge - 2); // keep a bit inside
        p.vx = rand(-0.04, 0.04);
        p.vz = rand(0.0, 0.02); // small forward, pumping/drift will carry it
        p.life = rand(200, 300);
        }

      // Keep particles in front of camera
      if (p.z < 0.6) p.z = 0.6;

      // Optional: side bounds so it feels like a lane
      if (p.x < -this.laneEdge) {
        p.x = -this.laneEdge;
        // remove bounce: damp lateral velocity so particles stop at the edge
        p.vx *= 0.05;
      }
      if (p.x > this.laneEdge) {
        p.x = this.laneEdge;
        p.vx *= 0.05;
      }

      p.life -= 1;
    }

    // Collision with enemy in world space (x/z)
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const dx = p.x - this.enemy.x;
      const dz = p.z - this.enemy.z;
      const d = Math.hypot(dx, dz);
     const r = this.enemyHitRadiusWorld();
      if (d < r) {
        p.life = 0;
        // damage scales inversely with spread: tight spread = more damage
        const damage = Math.max(1, Math.round(1 + (1 - this.spread) * 4));
        this.enemy.hp -= damage;
        this.enemy.flash = 6;

        if (this.enemy.hp <= 0) {
          this.score += 1;
          this.respawnEnemy();
        }
      }
    }

    // Cull dead
    this.particles = this.particles.filter((p) => p.life > 0);

    this.enemy.flash = Math.max(0, this.enemy.flash - 1);

    this.render(w, h);
  }

  private spawnParticle() {
    // Spawn in a small cloud near the camera.  The horizontal spread depends
    // on `this.spread`: when fingers are close (spread≈0) spawn area is
    // narrow; when fingers are wide spawn area widens.
    const z0 = rand(2.0, 6.0);
    // map spread (0..1) to half-width (1..6)
    const halfW = 1 + this.spread * 5;
    // center spawn on the pointer's screen X so particles immediately appear
    // around the finger. Convert pointer screen X to world X at this depth.
    const w = this.canvas.width;
    const centerX = w * 0.5;
    const pFactor = this.fov / (z0 + this.zNear);
    const pointerScreenX = this.pointerX * w;
    const worldCenterX = (pointerScreenX - centerX) / (pFactor * this.xScale);
    const x0 = worldCenterX + rand(-halfW, halfW);
    const vx0 = rand(-0.04, 0.04);
    const vz0 = rand(0.02, 0.06);

    // compute initial projection and style using a one-frame prediction
    const z1 = z0 + vz0;
    const s1 = this.project(x0, z1);
    const st1 = this.sandStyleForY(s1.screenY, this.canvas.height);

    this.particles.push({
      x: x0,
      z: z0,
      vx: vx0,
      vz: vz0,
      life: rand(300, 800),
      ch: PARTICLE_CHARS[Math.floor(Math.random() * PARTICLE_CHARS.length)],

      screenX: s1.screenX,
      screenY: s1.screenY,
      size: st1.size,
    });
  }

  private respawnEnemy() {
    // Enemy "in front" near the horizon (larger z)
    this.enemy = {
      x: rand(-4, 4),
      z: rand(18, 30),
      r: rand(1.2, 1.8),
      hp: 30,
      flash: 10,
    };
  }

  private project(x: number, z: number) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    const centerX = w * 0.5;
    const horizonY = h * this.horizonPct;

    // perspective factor (bigger when near, smaller when far)
    const p = this.fov / (z + this.zNear);

    const screenX = centerX + x * p * this.xScale;
    const screenY = horizonY + p * (h * this.floorSpanPct);

    return { screenX, screenY, p };
  }

  private render(w: number, h: number) {
    const ctx = this.ctx;
    
    // Background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, w, h);

    // ASCII font
    const baseFont = 16;
    ctx.font = `${baseFont}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Horizon + floor grid (depth cue = instant “3D”)
    const horizonY = h * this.horizonPct;

    // Horizon line
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#e8eef5";
    ctx.fillRect(0, horizonY, w, 1);
    ctx.globalAlpha = 1;

  // Converging lane lines (real lines, not dots)
ctx.globalAlpha = 0.18;
ctx.strokeStyle = "#e8eef5";
ctx.lineWidth = 1;
const laneEdge = this.laneEdge;
const laneStep = 2; // spacing between lane lines in world units

for (let x = -laneEdge; x <= laneEdge; x += laneStep) {
  ctx.beginPath();
  let first = true;

  for (let z = 6; z <= 2000; z += 20) {
    const s = this.project(x, z);
    if (first) { ctx.moveTo(s.screenX, s.screenY); first = false; }
    else { ctx.lineTo(s.screenX, s.screenY); }
  }

  ctx.stroke();
}

ctx.globalAlpha = 1;
 

    // Sort by depth: far -> near.  We can sort the array in place instead
    // of allocating a new one every frame.  The particle order is not
    // semantically important outside rendering.
    this.particles.sort((a, b) => b.z - a.z);
    const sortedParticles = this.particles;

    // draw particles in a single pass; style now derived from screen Y and
    // smoothed across frames.  we use a relatively low lerp factor so the
    // size/position change unfolds over many frames, giving more perceptible
    // steps.
    ctx.fillStyle = "#e8eef5";
    for (const p of sortedParticles) {
      const s = this.project(p.x, p.z);
      const st = this.sandStyleForY(s.screenY, h);

      const lerpFactor = 0.22;
      if (p.screenX !== undefined && p.screenY !== undefined) {
        p.screenX += (s.screenX - p.screenX) * lerpFactor;
        p.screenY += (s.screenY - p.screenY) * lerpFactor;
      } else {
        p.screenX = s.screenX;
        p.screenY = s.screenY;
      }

      if (p.size !== undefined) {
        p.size += (st.size - p.size) * lerpFactor;
      } else {
        p.size = st.size;
      }

      const drawX = p.screenX as number;
      const drawY = p.screenY as number;
      const drawSize = Math.max(1, Math.round(p.size as number));

      // shadow
      ctx.globalAlpha = 0.22;
      ctx.font = `${drawSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      ctx.fillText(this.glyphForDepth(p.z, p.ch), drawX, drawY);

      // main glyph
      ctx.globalAlpha = st.alpha;
      ctx.fillText(this.glyphForDepth(p.z, p.ch), drawX, drawY);
    }
    ctx.globalAlpha = 1;

    // Enemy (draw behind near particles: enemy is far, so draw now is fine)
    const e = this.enemy;
    const es = this.project(e.x, e.z);

    // Enemy “size” scales with p
    // We'll fake this by switching glyph and slightly changing font size
    const enemyP = es.p;
    const enemySize = Math.max(12, Math.min(28, Math.round(baseFont * (0.7 + enemyP * 0.9))));

    // Enemy shadow
    const face = this.enemyFace();

    // shadow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    ctx.font = `${enemySize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillText(face, es.screenX + 8, es.screenY + 8);

    // body
    ctx.globalAlpha = 1;
        // light red flash when hit
    if (e.flash > 0) {
      ctx.fillStyle = "#ff9a9a"; // soft red, not harsh
    } else {
      ctx.fillStyle = "#e8eef5";
    }

    ctx.fillText(face, es.screenX, es.screenY);
    // Restore font for HUD
    ctx.font = `${baseFont}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;

    // HUD
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8eef5";
    ctx.globalAlpha = 0.9;
    ctx.fillText(`Score: ${this.score}`, 16, 18);
    ctx.fillText(`Enemy HP: ${Math.max(0, e.hp)}`, 16, 38);
    ctx.globalAlpha = 1;

    if (this.debug) {
      ctx.globalAlpha = 0.8;
      ctx.fillText(
        `WindXZ: (${this.windXZ.x.toFixed(3)}, ${this.windXZ.z.toFixed(3)})`,
        16,
        58
      );
      ctx.globalAlpha = 1;
    }
    if (this.paused) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e8eef5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `20px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillText("PAUSED", w / 2, h / 2);

  ctx.restore();
}
  }

  // compute style based on distance from horizon in screen space; returns
  // float size and alpha.  uses a slight easing to make the transition gentler
  // near the top.
  private sandStyleForY(screenY: number, h: number) {
    const horizonY = h * this.horizonPct;
    const raw = Math.max(0, Math.min(1, (screenY - horizonY) / (h - horizonY)));
    const t = Math.pow(raw, 0.7);
    const size = 10 + 8 * t; // horizon ~10px → bottom ~18px
    const alpha = 0.25 + 0.70 * t; // horizon ~0.25 → bottom ~0.95
    return { size, alpha };
  }

  private glyphForDepth(z: number, fallback: string) {
    if (z > 26) return ".";
    if (z > 16) return ":";
    if (z > 8) return "*";
    return fallback;
  }
}