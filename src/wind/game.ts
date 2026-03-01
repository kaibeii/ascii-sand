import { playEnemyDeath, playPlayerHit, playWaveStart, playGameOver } from "./sounds";
import { startMusic, stopMusic } from "./sounds";
function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

type Particle = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  ch: string;
  screenX?: number;
  screenY?: number;
  size?: number;
};


export type EnemyKind = "small" | "normal" | "big" | "dodger" | "rusher" | "shielded";

type EnemyBehavior = {
  strafeDir: number;
  strafeSpeed: number;
  strafeTimer: number;
  strafePeriod: number;
  baseSpeed: number;
  shielded: boolean;
  shieldHP: number;
  shieldHPMax: number;
  shieldFlash: number;
};

type Enemy = {
  kind: EnemyKind;
  x: number;
  z: number;
  r: number;
  hp: number;
  hpMax: number;
  flash: number;
  scale: number;
  speed: number;
  behavior: EnemyBehavior;
};

type WaveEntry = { kind: EnemyKind; x?: number; delay: number };
type Wave = { enemies: WaveEntry[]; label: string };

const PARTICLE_CHARS = [".", ":", "*"];

function makeBehavior(kind: EnemyKind): EnemyBehavior {
  const base: EnemyBehavior = {
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeSpeed: 0,
    strafeTimer: 0,
    strafePeriod: 90,
    baseSpeed: 0.06,
    shielded: false,
    shieldHP: 0,
    shieldHPMax: 0,
    shieldFlash: 0,
  };
  if (kind === "dodger") {
    base.strafeSpeed = 0.04 + Math.random() * 0.025;
    base.strafePeriod = 55 + Math.floor(Math.random() * 40);
  }
  if (kind === "rusher") base.baseSpeed = 0.045;
  if (kind === "shielded") { base.shielded = true; base.shieldHP = 18; base.shieldHPMax = 18; }
  return base;
}

function makeEnemy(kind: EnemyKind, x: number, z: number): Enemy {
  const behavior = makeBehavior(kind);
  const configs: Record<EnemyKind, Omit<Enemy, "kind" | "x" | "z" | "behavior">> = {
    small:    { r: 1.15, hp: 22, hpMax: 22, flash: 0, scale: 0.82, speed: 0.075 },
    normal:   { r: 1.60, hp: 36, hpMax: 36, flash: 0, scale: 1.00, speed: 0.060 },
    big:      { r: 2.35, hp: 60, hpMax: 60, flash: 0, scale: 1.38, speed: 0.040 },
    dodger:   { r: 1.35, hp: 28, hpMax: 28, flash: 0, scale: 0.92, speed: 0.058 },
    rusher:   { r: 1.45, hp: 32, hpMax: 32, flash: 0, scale: 1.05, speed: 0.045 },
    shielded: { r: 1.70, hp: 45, hpMax: 45, flash: 0, scale: 1.10, speed: 0.048 },
  };
  return { kind, x, z, ...configs[kind], behavior };
}

function buildWaves(): Wave[] {
  return [
    { label: "WAVE 1", enemies: [{ kind: "normal", delay: 0 }, { kind: "small", delay: 40 }] },
    { label: "WAVE 2", enemies: [{ kind: "normal", delay: 0 }, { kind: "dodger", delay: 60 }, { kind: "small", delay: 240 }] },
    { label: "WAVE 3", enemies: [{ kind: "rusher", delay: 0 }, { kind: "dodger", delay: 60 }, { kind: "normal", delay: 220 }] },
    { label: "WAVE 4", enemies: [{ kind: "shielded", delay: 0 }, { kind: "rusher", delay: 60 }, { kind: "dodger", delay: 260 }] },
    { label: "WAVE 5", enemies: [{ kind: "big", delay: 0 }, { kind: "shielded", delay: 60 }, { kind: "rusher", delay: 200 }, { kind: "dodger", delay: 300 }] },
  ];
}

export class Game {
  private started = false;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private particles: Particle[] = [];
  private enemies: Enemy[] = [];
  private score = 0;
  private playerHP = 100;

  private waves: Wave[] = buildWaves();
  private waveIndex = 0;
  private waveTimer = 0;
  private pendingSpawns: Array<{ kind: EnemyKind; x?: number; spawnAt: number }> = [];
  private betweenWaves = false;
  private betweenWaveTimer = 0;
  private betweenWaveDuration = 180;
  private waveAnnounceTimer = 0;
  private waveAnnounceLabel = "";

  private laneEdge = 10;
  private zFar = 220;

  private windXZ: { x: number; z: number } = { x: 0, z: 0 };
  private debug = false;
  private lastPump = 0;
  private spread = 1;
  private pointerX = 0.5;

  private enemyAttackZ = 6.5;
  

  private horizonPct = 0.2;
  private fov = 20;
  private zNear = 2.0;
  private xScale = 100;
  private floorSpanPct = 0.4;

  private paused = false;
  private gameOverSoundPlayed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    this.ctx = ctx;
    this.startWave(0);
  }

  setDebug(v: boolean) { this.debug = v; }
  setPaused(v: boolean) {
    this.paused = v;
    if (v) stopMusic();
    else startMusic();
  }
  isPaused() { return this.paused; }
  start() { this.started = true; }

  setWind(wx: number, wz: number, spread = 1, pointerX = 0.5) {
    const kx = 0.020, kz = 0.06;
    const windX = -wx;
    let pump = -wz;
    const dz = 0.08;
    if (Math.abs(pump) < dz) pump = 0;
    else pump = Math.sign(pump) * (Math.abs(pump) - dz);
    pump = Math.sign(pump) * Math.pow(Math.abs(pump), 1.3);
    pump = Math.max(-4.0, Math.min(4.0, pump));
    if (pump < 0) pump *= 0.25;
    this.lastPump += (pump - this.lastPump) * 0.3;
    pump = this.lastPump;
    this.windXZ = { x: windX * kx, z: pump * kz };
    this.spread = Math.max(0, Math.min(1, spread));
    this.pointerX = Math.max(0, Math.min(1, pointerX));
  }

  tick() {
    if (!this.started) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.paused) { this.render(w, h); return; }
    if (this.playerHP <= 0) {
      if (!this.gameOverSoundPlayed) {
        playGameOver();
        this.gameOverSoundPlayed = true;
      }
      this.render(w, h);
      return;
    }

    this.waveTimer++;

    if (this.betweenWaves) {
      this.betweenWaveTimer++;
      if (this.betweenWaveTimer >= this.betweenWaveDuration) {
        this.betweenWaves = false;
        const next = this.waveIndex + 1;
        this.startWave(next < this.waves.length ? next : this.waves.length - 1);
      }
      this.spawnPending();
      this.updateParticles(w, h);
      this.render(w, h);
      return;
    }

    this.spawnPending();
    for (const e of this.enemies) this.updateEnemy(e);

    if (this.pendingSpawns.length === 0 && this.enemies.length === 0) {
      this.betweenWaves = true;
      this.betweenWaveTimer = 0;
      this.waveAnnounceLabel = this.waveIndex + 1 < this.waves.length
        ? `WAVE ${this.waveIndex + 2} INCOMING` : "ENDLESS MODE";
      this.waveAnnounceTimer = 120;
      
    }

    for (let i = 0; i < 6; i++) this.spawnParticle();
    this.updateParticles(w, h);

    for (const p of this.particles) {
      if (p.life <= 0) continue;
      for (const e of this.enemies) {
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < e.r) {
          p.life = 0;
          const damage = Math.max(0.2, (0.3 + (1 - this.spread) * 0.2));
          if (e.behavior.shielded && e.behavior.shieldHP > 0) {
            if (this.spread < 0.45) {
              e.behavior.shieldHP -= damage;
              e.behavior.shieldFlash = 8;
              if (e.behavior.shieldHP <= 0) { e.behavior.shieldHP = 0; e.behavior.shielded = false; e.flash = 12; }
            }
          } else {
            e.hp -= damage;
            e.flash = 6;
            if (e.hp <= 0) {
              this.score += this.scoreForKind(e.kind);
              this.playerHP = Math.min(100, this.playerHP + 4);
              playEnemyDeath();
              e.hp = -999;
            }
          }
          break;
        }
      }
    }

    this.enemies = this.enemies.filter(e => e.hp > -900);
    this.particles = this.particles.filter(p => p.life > 0);
    for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - 1);
      e.behavior.shieldFlash = Math.max(0, (e.behavior.shieldFlash || 0) - 1);
    }
    if (this.waveAnnounceTimer > 0) this.waveAnnounceTimer--;
    this.render(w, h);
  }

  private startWave(index: number) {
    this.waveIndex = index;
    this.waveTimer = 0;
    this.enemies = [];
    const wave = this.waves[Math.min(index, this.waves.length - 1)];
    const rep = Math.max(0, index - (this.waves.length - 1));
    this.pendingSpawns = wave.enemies.map(e => ({ kind: e.kind, x: e.x, spawnAt: e.delay + rep * 20 }));
    this.waveAnnounceLabel = wave.label + (rep > 0 ? ` +${rep}` : "");
    this.waveAnnounceTimer = 120;
    if (index > 0) playWaveStart();
  }

  private spawnPending() {
    const toSpawn = this.pendingSpawns.filter(s => this.waveTimer >= s.spawnAt);
    this.pendingSpawns = this.pendingSpawns.filter(s => this.waveTimer < s.spawnAt);
    for (const s of toSpawn) {
      const e = makeEnemy(s.kind, s.x !== undefined ? s.x : rand(-4, 4), rand(22, 34));
      e.flash = 10;
      this.enemies.push(e);
    }
  }

  private updateEnemy(e: Enemy) {
    const b = e.behavior;
    let speed = e.speed;
    if (e.kind === "rusher") speed = b.baseSpeed + Math.max(0, 1 - e.z / 30) * 0.12;
    e.z -= speed;
    if (e.kind === "dodger") {
      b.strafeTimer++;
      if (b.strafeTimer >= b.strafePeriod) { b.strafeDir *= -1; b.strafeTimer = 0; }
      e.x += b.strafeDir * b.strafeSpeed;
      if (e.x > this.laneEdge - 1) { e.x = this.laneEdge - 1; b.strafeDir = -1; }
      if (e.x < -this.laneEdge + 1) { e.x = -this.laneEdge + 1; b.strafeDir = 1; }
    }
    if (e.z <= this.enemyAttackZ) {
      // deal a single burst of damage then remove — no more continuous draining
      const dmg = e.kind === "big" ? 25 : e.kind === "small" ? 10 : 15;
      this.playerHP = Math.max(0, this.playerHP - dmg);
      playPlayerHit();
      e.hp = -999; // mark for removal
    }
  }

  private updateParticles(w: number, _h: number) {
    const drag = 0.985;
    for (const p of this.particles) {
      p.vx += this.windXZ.x; p.vz += this.windXZ.z; p.vz += 0.002;
      p.vx *= drag; p.vz *= drag;
      p.x += p.vx; p.z += p.vz;
      const proj = this.project(p.x, p.z);
      const worldDelta = (this.pointerX * w - proj.screenX) / Math.max(1e-6, proj.p * this.xScale);
      if (this.spread < 0.5) {
        const desiredVx = worldDelta * (1 - this.spread) * 0.5;
        p.vx = p.vx * 0.78 + desiredVx * 0.22;
      }
      p.vx = Math.max(-0.9, Math.min(0.9, p.vx));
      if (this.spread < 0.18) p.vx *= 0.08;
      if (p.z > this.zFar) { p.z = rand(2, 6); p.x = rand(-8, 8); p.vx = rand(-0.04, 0.04); p.vz = rand(0, 0.02); p.life = rand(300, 800); }
      if (p.z < 0.6) p.z = 0.6;
      if (p.x < -this.laneEdge) { p.x = -this.laneEdge; p.vx *= 0.05; }
      if (p.x > this.laneEdge)  { p.x = this.laneEdge;  p.vx *= 0.05; }
      p.life -= 1;
    }
  }

  private spawnParticle() {
    const z0 = rand(2, 6), halfW = 1 + this.spread * 5;
    const w = this.canvas.width;
    const pFactor = this.fov / (z0 + this.zNear);
    const worldCenterX = (this.pointerX * w - w * 0.5) / Math.max(1e-6, pFactor * this.xScale);
    const x0 = worldCenterX + rand(-halfW, halfW);
    const vz0 = rand(0.02, 0.06);
    const s1 = this.project(x0, z0 + vz0);
    const st1 = this.sandStyleForY(s1.screenY, this.canvas.height);
    this.particles.push({ x: x0, z: z0, vx: rand(-0.04, 0.04), vz: vz0, life: rand(300, 800), ch: PARTICLE_CHARS[Math.floor(Math.random() * 3)], screenX: s1.screenX, screenY: s1.screenY, size: st1.size });
  }

  private scoreForKind(kind: EnemyKind): number {
    return { small: 1, normal: 2, big: 4, dodger: 3, rusher: 3, shielded: 5 }[kind];
  }

  private enemyFace(e: Enemy): string {
    if (e.flash > 0) return "(ಠ益ಠ)";
    if (e.hp < Math.max(6, e.hpMax * 0.2)) return "(x_x)";
    return { small: "(>_<)", normal: "(ಠ_ಠ)", big: "(ಠ益ಠ)", dodger: "(°▽°)", rusher: "(▶▶▶)", shielded: "(#_#)" }[e.kind];
  }

  private enemyBody(e: Enemy): string[] {
    if (e.kind === "shielded") {
      const full = Math.round((e.behavior.shieldHP / e.behavior.shieldHPMax) * 5);
      return e.behavior.shieldHP > 0
        ? [`[${"|".repeat(full)}${" ".repeat(5 - full)}]`, "/|\\", " | "]
        : ["[   ]", "/|\\", " | "];
    }
    return { small: [" o ", "/|\\"], normal: [" O ", "/|\\", " | "], big: ["\\O/", "=|=", " | "], dodger: [" ~ ", "\\|/"], rusher: [">-<", "/=\\"], shielded: ["/|\\", " | "] }[e.kind];
  }

  private project(x: number, z: number) {
    const w = this.canvas.width, h = this.canvas.height;
    const p = this.fov / (z + this.zNear);
    return {
      screenX: w * 0.5 + x * p * this.xScale,
      screenY: h * this.horizonPct + p * (h * this.floorSpanPct),
      p,
    };
  }

  private render(w: number, h: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, w, h);

    const baseFont = 16;
    ctx.font = `${baseFont}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // horizon
    const horizonY = h * this.horizonPct;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#e8eef5";
    ctx.fillRect(0, horizonY, w, 1);
    ctx.globalAlpha = 1;

    // lane grid
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#e8eef5";
    ctx.lineWidth = 1;
    for (let x = -this.laneEdge; x <= this.laneEdge; x += 2) {
      ctx.beginPath();
      let first = true;
      for (let z = 6; z <= 2000; z += 20) {
        const s = this.project(x, z);
        if (first) { ctx.moveTo(s.screenX, s.screenY); first = false; }
        else ctx.lineTo(s.screenX, s.screenY);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // particles
    this.particles.sort((a, b) => b.z - a.z);
    ctx.fillStyle = "#e8eef5";
    for (const p of this.particles) {
      const s = this.project(p.x, p.z);
      const st = this.sandStyleForY(s.screenY, h);
      const lf = 0.22;
      p.screenX = p.screenX !== undefined ? p.screenX + (s.screenX - p.screenX) * lf : s.screenX;
      p.screenY = p.screenY !== undefined ? p.screenY + (s.screenY - p.screenY) * lf : s.screenY;
      p.size    = p.size    !== undefined ? p.size    + (st.size    - p.size)    * lf : st.size;
      const sz = Math.max(1, Math.round(p.size));
      ctx.font = `${sz}px ui-monospace, monospace`;
      ctx.globalAlpha = 0.22;
      ctx.fillText(this.glyphForDepth(p.z, p.ch), p.screenX, p.screenY);
      ctx.globalAlpha = st.alpha;
      ctx.fillText(this.glyphForDepth(p.z, p.ch), p.screenX, p.screenY);
    }
    ctx.globalAlpha = 1;

    // enemies
    for (const e of [...this.enemies].sort((a, b) => b.z - a.z)) {
      this.renderEnemy(e, baseFont, h);
    }

    // HUD
    this.renderHUD(w, h);

    // wave announce
    if (this.waveAnnounceTimer > 0) {
      const a = Math.pow(Math.min(1, this.waveAnnounceTimer / 30), 2) * 0.92;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#e8eef5";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold 22px ui-monospace, monospace`;
      ctx.fillText(this.waveAnnounceLabel, w / 2, h * 0.42);
      ctx.restore();
    }

    if (this.betweenWaves) {
      const t = this.betweenWaveTimer / this.betweenWaveDuration;
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = "#e8eef5";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `14px ui-monospace, monospace`;
      ctx.fillText("prepare...", w / 2, h * 0.54);
      ctx.restore();
    }

    if (this.paused) {
      ctx.save();
      ctx.globalAlpha = 0.6; ctx.fillStyle = "#0b0f14"; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1; ctx.fillStyle = "#e8eef5";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `20px ui-monospace, monospace`;
      ctx.fillText("PAUSED", w / 2, h / 2);
      ctx.restore();
    }

    if (this.playerHP <= 0) {
      ctx.save();
      ctx.globalAlpha = 0.72; ctx.fillStyle = "#0b0f14"; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1; ctx.fillStyle = "#e8eef5";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `20px ui-monospace, monospace`;
      ctx.fillText("GAME OVER", w / 2, h / 2 - 20);
      ctx.font = `13px ui-monospace, monospace`;
      ctx.fillText(`Final Score: ${this.score}`, w / 2, h / 2 + 8);
    ctx.fillText("press R to restart", w / 2, h / 2 + 30);
      ctx.restore();
    }
  }

  private renderEnemy(e: Enemy, baseFont: number, _h: number) {
    const ctx = this.ctx;
    const es = this.project(e.x, e.z);
    const enemySize = Math.round(Math.max(12, Math.min(28, Math.round(baseFont * (0.7 + es.p * 0.9)))) * e.scale);
    const lineH = enemySize * 1.3;
    const lines = [this.enemyFace(e), ...this.enemyBody(e)];
    const totalH = lines.length * lineH;
    const topY = es.screenY - totalH / 2;

    ctx.font = `${enemySize}px ui-monospace, monospace`;

    // shadow
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    lines.forEach((line, i) => ctx.fillText(line, es.screenX + 6, topY + i * lineH + lineH / 2 + 6));

    // shield glow
    if (e.kind === "shielded" && e.behavior.shieldHP > 0) {
      const pct = e.behavior.shieldHP / e.behavior.shieldHPMax;
      ctx.globalAlpha = 0.18 + pct * 0.25;
      ctx.strokeStyle = e.behavior.shieldFlash > 0 ? "#ffe066" : "#66cfff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(es.screenX, es.screenY, enemySize * 2.2, totalH * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // body
    const colors: Record<EnemyKind, string> = { small: "#e8eef5", normal: "#e8eef5", big: "#ffb347", dodger: "#a8f0c8", rusher: "#ff7f7f", shielded: "#b0c8ff" };
    ctx.globalAlpha = 1;
    ctx.fillStyle = e.flash > 0 ? "#ff9a9a" : colors[e.kind];
    lines.forEach((line, i) => ctx.fillText(line, es.screenX, topY + i * lineH + lineH / 2));

    // HP bar
    if (e.z < 22 || e.hp < e.hpMax) this.renderEnemyHPBar(e, es.screenX, topY - 10, enemySize);
    ctx.globalAlpha = 1;
  }

  private renderEnemyHPBar(e: Enemy, cx: number, y: number, size: number) {
    const ctx = this.ctx;
    const barW = size * 3.5, barH = 5, x = cx - barW / 2;
    const pct = Math.max(0, e.hp / e.hpMax);
    ctx.globalAlpha = 0.6; ctx.fillStyle = "#1a2030"; ctx.fillRect(x, y, barW, barH);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = pct > 0.5 ? "#4cff8a" : pct > 0.25 ? "#ffd966" : "#ff5555";
    ctx.fillRect(x, y, barW * pct, barH);
    if (e.kind === "shielded" && e.behavior.shieldHP > 0) {
      ctx.globalAlpha = 0.7; ctx.fillStyle = "#66cfff";
      ctx.fillRect(x, y - 7, barW * (e.behavior.shieldHP / e.behavior.shieldHPMax), 4);
    }
    ctx.globalAlpha = 1;
  }

  // --- HUD: two-row layout (label top, value bottom) ---
  private renderHUD(w: number, h: number) {
    const ctx = this.ctx;
    const PAD = 18;
    const HUD_H = 56;

    // background
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, w, HUD_H);
    ctx.globalAlpha = 1;

    // bottom border
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#e8eef5";
    ctx.fillRect(0, HUD_H, w, 1);
    ctx.globalAlpha = 1;

    const MONO = `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    const labelFont = `10px ${MONO}`;
    const valueFont = `bold 16px ${MONO}`;
    const LABEL_Y = 15;   // small caps label row
    const VALUE_Y = 39;   // large value row

    ctx.textBaseline = "middle";

    // ---- LEFT: WAVE ----
    ctx.textAlign = "left";
    ctx.globalAlpha = 0.5; ctx.fillStyle = "#e8eef5";
    ctx.font = labelFont; ctx.fillText("WAVE", PAD, LABEL_Y);
    ctx.globalAlpha = 1; ctx.fillStyle = "#ffe066";
    ctx.font = valueFont; ctx.fillText(`${this.waveIndex + 1}`, PAD, VALUE_Y);

    // ---- SCORE ----
    const scoreX = PAD + 72;
    ctx.globalAlpha = 0.5; ctx.fillStyle = "#e8eef5";
    ctx.font = labelFont; ctx.fillText("SCORE", scoreX, LABEL_Y);
    ctx.globalAlpha = 1; ctx.fillStyle = "#e8eef5";
    ctx.font = valueFont; ctx.fillText(`${this.score}`, scoreX, VALUE_Y);

    // ---- CENTER: HP bar + label ----
    const hpBarW = Math.min(260, w * 0.30);
    const hpBarH = 12;
    const hpBarX = w / 2 - hpBarW / 2;
    const hpBarY = VALUE_Y - hpBarH / 2;
    const hpPct = Math.max(0, this.playerHP / 100);
    const hpColor = hpPct > 0.5 ? "#4cff8a" : hpPct > 0.25 ? "#ffd966" : "#ff5555";

    ctx.globalAlpha = 0.5; ctx.fillStyle = "#e8eef5";
    ctx.font = labelFont; ctx.textAlign = "center";
    ctx.fillText("PLAYER HP", w / 2, LABEL_Y);

    ctx.globalAlpha = 0.35; ctx.fillStyle = "#1a2030";
    ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
    ctx.globalAlpha = 0.9; ctx.fillStyle = hpColor;
    ctx.fillRect(hpBarX, hpBarY, hpBarW * hpPct, hpBarH);
    ctx.globalAlpha = 0.3; ctx.strokeStyle = "#e8eef5"; ctx.lineWidth = 1;
    ctx.strokeRect(hpBarX, hpBarY, hpBarW, hpBarH);

    ctx.globalAlpha = 1; ctx.fillStyle = hpColor;
    ctx.font = valueFont; ctx.textAlign = "center";
    // numeric value to the RIGHT of the bar
    ctx.globalAlpha = 1; ctx.fillStyle = hpColor;
    ctx.font = valueFont; ctx.textAlign = "left";
    ctx.fillText(`${Math.ceil(this.playerHP)}`, hpBarX + hpBarW + 10, VALUE_Y);

    // ---- RIGHT: ENEMIES label + count on same row, dots on value row ----
    const remaining = this.enemies.length + this.pendingSpawns.length;
    ctx.textAlign = "right";

   // "ENEMIES" label dimmed
      ctx.globalAlpha = 0.5; ctx.fillStyle = "#e8eef5";
      ctx.font = labelFont; ctx.textAlign = "right";
      ctx.fillText("ENEMIES", w - PAD - 20, LABEL_Y);

      // count to the right of label
      ctx.globalAlpha = 1;
      ctx.fillStyle = remaining > 0 ? "#ff7f7f" : "#4cff8a";
      ctx.textAlign = "right";
      ctx.fillText(`${remaining}`, w - PAD, LABEL_Y);
    // enemy type dots on the value row
    const dotColors: Record<EnemyKind, string> = { small: "#e8eef5", normal: "#e8eef5", big: "#ffb347", dodger: "#a8f0c8", rusher: "#ff7f7f", shielded: "#b0c8ff" };
    this.enemies.slice(0, 8).forEach((e, i) => {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = dotColors[e.kind];
      ctx.beginPath();
      ctx.arc(w - PAD - i * 14, VALUE_Y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1;

    if (this.debug) {
      ctx.textAlign = "left"; ctx.font = labelFont; ctx.fillStyle = "#e8eef5"; ctx.globalAlpha = 0.65;
      ctx.fillText(`wind(${this.windXZ.x.toFixed(3)}, ${this.windXZ.z.toFixed(3)})  spread:${this.spread.toFixed(2)}  particles:${this.particles.length}`, PAD, h - 10);
      ctx.globalAlpha = 1;
    }
  }

  private sandStyleForY(screenY: number, h: number) {
    const raw = Math.max(0, Math.min(1, (screenY - h * this.horizonPct) / (h - h * this.horizonPct)));
    const t = Math.pow(raw, 0.7);
    return { size: 10 + 8 * t, alpha: 0.25 + 0.70 * t };
  }

  private glyphForDepth(z: number, fallback: string) {
    if (z > 26) return ".";
    if (z > 16) return ":";
    if (z > 8) return "*";
    return fallback;
  }
}