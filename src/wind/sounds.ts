// Synthesized sound effects using Web Audio API — no files needed

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function master(gain: number): GainNode {
  const g = getCtx().createGain();
  g.gain.value = gain;
  g.connect(getCtx().destination);
  return g;
}

// ---------------------------------------------------------------------------
// CHIPTUNE MUSIC
// ---------------------------------------------------------------------------
// A simple looping melody + bass line using square/triangle oscillators.
// Call startMusic() once when the game begins, stopMusic() on game over.

const BPM = 140;
const BEAT = 60 / BPM;         // seconds per beat


// Melody: note frequencies (Hz), 0 = rest. Two bars that loop.
const MELODY: number[] = [
  330, 0,   392, 0,   440, 392, 330, 0,
  294, 0,   330, 0,   392, 0,   440, 0,
  330, 0,   392, 440, 494, 0,   440, 392,
  330, 294, 262, 0,   294, 330, 0,   0,
];

// Bass line: one note per beat, two bars
const BASS: number[] = [
  110, 110, 138, 138,
  98,  98,  110, 110,
  110, 110, 138, 147,
  98,  98,  110, 110,
];

let musicGain: GainNode | null = null;
let musicRunning = false;
let musicTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleBar(startTime: number, loop: () => void) {
  if (!musicRunning) return;
  const ac = getCtx();

  const stepDur = BEAT / 2; // 8th notes for melody

  // --- melody (square wave, quiet) ---
  MELODY.forEach((freq, i) => {
    if (freq === 0) return;
    const t = startTime + i * stepDur;
    const osc = ac.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.01);
    env.gain.setValueAtTime(1, t + stepDur * 0.55);
    env.gain.linearRampToValueAtTime(0, t + stepDur * 0.8);
    osc.connect(env);
    env.connect(musicGain!);
    osc.start(t);
    osc.stop(t + stepDur);
  });

  // --- bass (triangle wave) ---
  BASS.forEach((freq, i) => {
    const t = startTime + i * BEAT;
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.02);
    env.gain.setValueAtTime(1, t + BEAT * 0.6);
    env.gain.linearRampToValueAtTime(0, t + BEAT * 0.85);
    osc.connect(env);
    env.connect(musicGain!);
    osc.start(t);
    osc.stop(t + BEAT);
  });

  // schedule next bar slightly before this one ends
  const barDuration = MELODY.length * stepDur;
  const msUntilNext = (startTime + barDuration - ac.currentTime - 0.05) * 1000;
  musicTimeout = setTimeout(() => {
    scheduleBar(startTime + barDuration, loop);
  }, Math.max(0, msUntilNext));
}

export function startMusic() {
  if (musicRunning) return;
  musicRunning = true;
  const ac = getCtx();
  musicGain = ac.createGain();
  musicGain.gain.value = 0.07; // quiet background volume
  musicGain.connect(ac.destination);
  scheduleBar(ac.currentTime + 0.1, () => {});
}

export function stopMusic() {
  musicRunning = false;
  if (musicTimeout) clearTimeout(musicTimeout);
  if (musicGain) {
    musicGain.gain.setValueAtTime(musicGain.gain.value, getCtx().currentTime);
    musicGain.gain.linearRampToValueAtTime(0, getCtx().currentTime + 0.3);
  }
}

// ---------------------------------------------------------------------------
// SOUND EFFECTS
// ---------------------------------------------------------------------------

// --- Enemy death: short descending blip ---
export function playEnemyDeath() {
  const ac = getCtx();
  const g = master(0.25);
  const osc = ac.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(520, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.18);
  const env = ac.createGain();
  env.gain.setValueAtTime(1, ac.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
  osc.connect(env);
  env.connect(g);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.2);
}

// --- Player hit: low thud + brief noise burst ---
export function playPlayerHit() {
  const ac = getCtx();

  const g = master(0.3);
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ac.currentTime + 0.15);
  const env = ac.createGain();
  env.gain.setValueAtTime(1, ac.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
  osc.connect(env); env.connect(g);
  osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.18);

  const bufSize = ac.sampleRate * 0.08;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const nEnv = ac.createGain();
  nEnv.gain.setValueAtTime(0.18, ac.currentTime);
  nEnv.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
  noise.connect(nEnv); nEnv.connect(ac.destination);
  noise.start(ac.currentTime);
}

// --- Wave start: ascending arpeggio ---
export function playWaveStart() {
  const ac = getCtx();
  const notes = [220, 277, 330, 440];
  notes.forEach((freq, i) => {
    const t = ac.currentTime + i * 0.1;
    const g = master(0.15);
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    const env = ac.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(env); env.connect(g);
    osc.start(t); osc.stop(t + 0.2);
  });
}

// --- Game over: descending sad tones ---
export function playGameOver() {
  stopMusic();
  const ac = getCtx();
  const notes = [330, 277, 220, 165];
  notes.forEach((freq, i) => {
    const t = ac.currentTime + i * 0.22;
    const g = master(0.2);
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.8, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(env); env.connect(g);
    osc.start(t); osc.stop(t + 0.32);
  });
}