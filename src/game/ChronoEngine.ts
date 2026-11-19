import { ChronoAudio } from './audio';
import { generateDailyChamber, LOOP_DURATION, MAX_CLONES, WORLD_H, WORLD_W } from './levelGen';
import {
  borrowCommunityClone,
  fetchInit,
  ShareCommentResponse,
  shareTimelineComment,
  submitClear,
} from './redditApi';
import {
  CHANNEL_HEX,
  ChannelId,
  CLONE_COLORS,
  CloneRecording,
  CloneSample,
  DailyChamber,
  GamePhase,
  GameSnapshot,
  GateDoor,
  getUtcDateString,
  LeaderboardEntry,
  TimelineEvent,
  Vec2,
  WallRect,
} from './types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface LaserRayResult {
  id: string;
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  blockedByClone: boolean;
}

const PLAYER_R = 0.34;
const PLAYER_SPEED = 5.6;
const SAMPLE_INTERVAL = 1 / 30;
const LOCAL_STORAGE_PREFIX = 'chrono_loop_v1_';

export class ChronoEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: ChronoAudio;
  private onSnapshot: (snap: GameSnapshot) => void;

  private seed: string = getUtcDateString();
  private isDailyMode = true;
  private chamber: DailyChamber;
  private phase: GamePhase = 'title';

  // Time loop state
  private activeCloneIndex = 0;
  private loopTime = 0;
  private totalElapsed = 0;
  private clearTimeMs: number | null = null;
  private failReason: string | null = null;
  private rewindTimer = 0;
  private lastTickSecond = 4;

  // Active player state
  private player: Vec2 = { x: 1.7, y: 5.0 };
  private playerTrail: Vec2[] = [];
  private activeSamples: CloneSample[] = [];
  private nextSampleTime = 0;

  // Recorded past clones
  private recordings: CloneRecording[] = [];
  private borrowedCloneOwner: string | null = null;

  // Shards & events
  private collectedShardIds = new Set<string>();
  private timelineEvents: TimelineEvent[] = [];
  private activeChannels: Record<ChannelId, boolean> = { cyan: false, magenta: false, gold: false };
  private prevChannels: Record<ChannelId, boolean> = { cyan: false, magenta: false, gold: false };
  private activeLaserRays: LaserRayResult[] = [];
  private lastLaserBlockSound = 0;

  // Particles & visual FX
  private particles: Particle[] = [];
  private animTime = 0;
  private screenShake = 0;
  private rewindWave = 0;

  // Input state (Keyboard + 1-thumb virtual joystick)
  private keys = new Set<string>();
  private pointerActive = false;
  private pointerId: number | null = null;
  private joyOrigin: Vec2 = { x: 0, y: 0 };
  private joyCurrent: Vec2 = { x: 0, y: 0 };
  private joyVec: Vec2 = { x: 0, y: 0 };

  // Viewport transform (world -> screen pixels)
  private viewScale = 40;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private canvasW = 800;
  private canvasH = 600;

  // Reddit / Devvit state
  private redditConnected = false;
  private redditUsername: string | null = null;
  private subredditName: string | null = null;
  private streak = 0;
  private bestTimeMs: number | null = null;
  private dailySolvers = 0;
  private availableCommunityClones = 0;
  private leaderboard: LeaderboardEntry[] = [];
  private playerRank: number | null = null;

  private rafId = 0;
  private lastFrameMs = 0;
  private hudEmitAccum = 0;

  constructor(
    canvas: HTMLCanvasElement,
    audio: ChronoAudio,
    onSnapshot: (snap: GameSnapshot) => void
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.audio = audio;
    this.onSnapshot = onSnapshot;

    this.chamber = generateDailyChamber(this.seed);
    this.loadLocalProgress();
    this.resetRunToChamber(false);
    this.bindEvents();
    this.handleResize();
    this.emitSnapshot();
    void this.initReddit();
  }

  private async initReddit(): Promise<void> {
    const data = await fetchInit(this.seed);
    if (!data) return;
    this.redditConnected = true;
    this.redditUsername = data.isGuest ? null : data.username;
    this.subredditName = data.subredditName || null;
    this.streak = Math.max(this.streak, data.streak);
    if (data.bestTimeMs !== null) {
      this.bestTimeMs =
        this.bestTimeMs === null ? data.bestTimeMs : Math.min(this.bestTimeMs, data.bestTimeMs);
    }
    this.dailySolvers = data.dailySolvers;
    this.availableCommunityClones = data.availableCommunityClones;
    this.leaderboard = data.leaderboard;
    this.playerRank = data.playerRank;
    this.emitSnapshot();
  }

  private loadLocalProgress(): void {
    try {
      const rawStreak = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}streak`);
      if (rawStreak) {
        const parsed = JSON.parse(rawStreak) as { count?: number; lastDate?: string };
        const today = getUtcDateString(0);
        const yesterday = getUtcDateString(-1);
        if (parsed.lastDate === today || parsed.lastDate === yesterday) {
          this.streak = Math.max(0, Number(parsed.count) || 0);
        }
      }
      const rawBest = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}best_${this.seed}`);
      if (rawBest) {
        const ms = Number.parseInt(rawBest, 10);
        if (Number.isFinite(ms) && ms > 0) this.bestTimeMs = ms;
      }
    } catch {
      // Ignore storage restrictions
    }
  }

  private saveLocalClear(timeMs: number): void {
    try {
      if (this.bestTimeMs === null || timeMs < this.bestTimeMs) {
        this.bestTimeMs = timeMs;
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}best_${this.seed}`, String(Math.floor(timeMs)));
      }
      if (this.isDailyMode) {
        const today = getUtcDateString(0);
        const yesterday = getUtcDateString(-1);
        const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}streak`);
        let count = 1;
        if (raw) {
          const parsed = JSON.parse(raw) as { count?: number; lastDate?: string };
          if (parsed.lastDate === today) count = Math.max(1, Number(parsed.count) || 1);
          else if (parsed.lastDate === yesterday) count = (Number(parsed.count) || 0) + 1;
        }
        this.streak = Math.max(this.streak, count);
        localStorage.setItem(
          `${LOCAL_STORAGE_PREFIX}streak`,
          JSON.stringify({ count: this.streak, lastDate: today })
        );
      }
    } catch {
      // Ignore storage errors
    }
  }

  public startLoop(): void {
    this.lastFrameMs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  public startDaily(): void {
    this.audio.unlock();
    this.seed = getUtcDateString();
    this.isDailyMode = true;
    this.chamber = generateDailyChamber(this.seed);
    this.resetRunToChamber(true);
  }

  public startPracticeOffset(daysAgo: number): void {
    this.audio.unlock();
    this.seed = getUtcDateString(-Math.abs(daysAgo));
    this.isDailyMode = daysAgo === 0;
    this.chamber = generateDailyChamber(this.seed);
    this.bestTimeMs = null;
    this.loadLocalProgress();
    this.resetRunToChamber(true);
  }

  public restartChamber(): void {
    this.audio.unlock();
    this.resetRunToChamber(true);
  }

  public lockAndNextClone(): void {
    if (this.phase !== 'playing') return;
    if (this.activeCloneIndex >= MAX_CLONES - 1) {
      this.triggerFail('All 3 clones exhausted — reset and optimize your route!');
      return;
    }
    this.commitCurrentCloneAndRewind();
  }

  public async summonCommunityClone(): Promise<{ ok: boolean; message: string }> {
    this.audio.unlock();
    const res = await borrowCommunityClone(this.seed);
    if (!res.ok || !res.samples || res.samples.length < 2 || !res.username) {
      return { ok: false, message: res.error ?? 'No community clones yet today' };
    }

    // Reset attempt and preload Clone α with the borrowed Redditor's real recording!
    this.resetRunToChamber(true);
    this.recordings = [
      {
        index: 0,
        samples: res.samples,
        duration: res.duration ?? res.samples[res.samples.length - 1].t,
        borrowedFrom: res.username,
      },
    ];
    this.borrowedCloneOwner = res.username;
    this.activeCloneIndex = 1;
    this.loopTime = 0;
    this.totalElapsed = Math.min(LOOP_DURATION, this.recordings[0].duration);
    this.player = { ...this.chamber.spawn };
    this.playerTrail = [];
    this.activeSamples = [{ t: 0, x: this.player.x, y: this.player.y }];
    this.nextSampleTime = SAMPLE_INTERVAL;
    this.audio.playRewind();
    this.rewindWave = 1.0;
    this.emitSnapshot();
    return { ok: true, message: `Summoned u/${res.username}'s Clone α!` };
  }

  public async shareToReddit(): Promise<ShareCommentResponse> {
    if (this.clearTimeMs === null) {
      return { ok: false, error: 'Clear the chamber first!' };
    }
    return shareTimelineComment({
      seed: this.seed,
      timeMs: this.clearTimeMs,
      clonesUsed: this.activeCloneIndex + 1,
      shards: this.collectedShardIds.size,
      timelineText: this.buildTimelineText(),
      streak: this.streak,
      borrowedFrom: this.borrowedCloneOwner,
    });
  }

  private resetRunToChamber(startImmediately: boolean): void {
    this.phase = startImmediately ? 'playing' : 'title';
    this.activeCloneIndex = 0;
    this.loopTime = 0;
    this.totalElapsed = 0;
    this.clearTimeMs = null;
    this.failReason = null;
    this.rewindTimer = 0;
    this.lastTickSecond = 4;
    this.recordings = [];
    this.borrowedCloneOwner = null;
    this.collectedShardIds.clear();
    this.timelineEvents = [];
    this.activeChannels = { cyan: false, magenta: false, gold: false };
    this.prevChannels = { cyan: false, magenta: false, gold: false };
    this.player = { ...this.chamber.spawn };
    this.playerTrail = [];
    this.activeSamples = [{ t: 0, x: this.player.x, y: this.player.y }];
    this.nextSampleTime = SAMPLE_INTERVAL;
    this.particles = [];
    this.screenShake = 0;
    this.rewindWave = 0;
    this.evaluateChamberState(false);
    this.emitSnapshot();
  }

  private commitCurrentCloneAndRewind(): void {
    // Save final sample
    this.activeSamples.push({
      t: Number(this.loopTime.toFixed(3)),
      x: Number(this.player.x.toFixed(3)),
      y: Number(this.player.y.toFixed(3)),
    });
    this.recordings.push({
      index: this.activeCloneIndex,
      samples: this.activeSamples,
      duration: this.loopTime,
    });
    this.activeCloneIndex++;
    this.phase = 'rewinding';
    this.rewindTimer = 0.42;
    this.rewindWave = 1.0;
    this.audio.playRewind();
    this.haptic(24);
    this.spawnBurst(this.player.x, this.player.y, CLONE_COLORS[this.activeCloneIndex - 1].hex, 18);
    this.emitSnapshot();
  }

  private triggerFail(reason: string): void {
    this.phase = 'failed';
    this.failReason = reason;
    this.screenShake = 0.35;
    this.audio.playFail();
    this.haptic([35, 30, 50]);
    this.spawnBurst(this.player.x, this.player.y, '#ff3366', 28);
    this.emitSnapshot();
  }

  private triggerVictory(): void {
    this.phase = 'victory';
    this.clearTimeMs = Math.max(500, Math.round(this.totalElapsed * 1000));
    this.timelineEvents.push({
      cloneIndex: this.activeCloneIndex,
      t: this.loopTime,
      kind: 'core',
    });
    this.audio.playVictory();
    this.haptic([20, 40, 20, 40, 60]);
    this.spawnBurst(this.chamber.core.x, this.chamber.core.y, '#fbbf24', 42);
    this.spawnBurst(this.chamber.core.x, this.chamber.core.y, '#38bdf8', 24);
    this.saveLocalClear(this.clearTimeMs);

    if (this.redditConnected && this.isDailyMode) {
      const alphaSamples =
        this.recordings.length > 0 && !this.recordings[0].borrowedFrom
          ? this.recordings[0].samples
          : this.activeCloneIndex === 0
            ? this.activeSamples
            : undefined;
      void submitClear({
        seed: this.seed,
        timeMs: this.clearTimeMs,
        clonesUsed: this.activeCloneIndex + 1,
        shards: this.collectedShardIds.size,
        alphaSamples,
      }).then((res) => {
        if (!res) return;
        this.streak = Math.max(this.streak, res.streak);
        this.bestTimeMs = res.bestTimeMs;
        this.dailySolvers = res.dailySolvers;
        this.availableCommunityClones = res.availableCommunityClones;
        this.leaderboard = res.leaderboard;
        this.playerRank = res.playerRank;
        this.emitSnapshot();
      });
    }

    this.emitSnapshot();
  }

  private sampleClonePosition(rec: CloneRecording, t: number): Vec2 {
    const s = rec.samples;
    if (s.length === 0) return { ...this.chamber.spawn };
    if (t <= s[0].t) return { x: s[0].x, y: s[0].y };
    const last = s[s.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y };

    // Binary search for segment
    let lo = 0;
    let hi = s.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = s[lo];
    const b = s[hi];
    const span = Math.max(0.0001, b.t - a.t);
    const f = (t - a.t) / span;
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
    };
  }

  private getPastClonePositions(): Array<{ index: number; x: number; y: number; borrowedFrom?: string }> {
    return this.recordings.map((rec) => {
      const pos = this.sampleClonePosition(rec, this.loopTime);
      return { index: rec.index, x: pos.x, y: pos.y, borrowedFrom: rec.borrowedFrom };
    });
  }

  private update(dt: number): void {
    this.animTime += dt;
    this.screenShake = Math.max(0, this.screenShake - dt * 1.8);
    this.rewindWave = Math.max(0, this.rewindWave - dt * 2.2);

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (this.phase === 'rewinding') {
      this.rewindTimer -= dt;
      if (this.rewindTimer <= 0) {
        this.phase = 'playing';
        this.loopTime = 0;
        this.lastTickSecond = 4;
        this.player = { ...this.chamber.spawn };
        this.playerTrail = [];
        this.activeSamples = [{ t: 0, x: this.player.x, y: this.player.y }];
        this.nextSampleTime = SAMPLE_INTERVAL;
        this.emitSnapshot();
      }
      return;
    }

    if (this.phase !== 'playing') {
      this.evaluateChamberState(false);
      return;
    }

    this.loopTime += dt;
    this.totalElapsed += dt;

    // Urgent countdown audio tick in final 3 seconds
    const remaining = Math.max(0, this.chamber.loopDuration - this.loopTime);
    const secCeil = Math.ceil(remaining);
    if (secCeil <= 3 && secCeil < this.lastTickSecond && secCeil > 0) {
      this.lastTickSecond = secCeil;
      this.audio.playTick(secCeil === 1);
    }

    // Compute movement input vector (keyboard + 1-thumb virtual joystick)
    let ix = 0;
    let iy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) ix += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) iy -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) iy += 1;

    if (this.pointerActive && (Math.abs(this.joyVec.x) > 0.04 || Math.abs(this.joyVec.y) > 0.04)) {
      ix = this.joyVec.x;
      iy = this.joyVec.y;
    }

    const mag = Math.hypot(ix, iy);
    if (mag > 1) {
      ix /= mag;
      iy /= mag;
    }

    // Move player & resolve collisions against walls + currently closed gates
    this.player.x += ix * PLAYER_SPEED * dt;
    this.player.y += iy * PLAYER_SPEED * dt;
    this.resolvePlayerCollisions();

    // Trail & recording
    if (mag > 0.05) {
      this.playerTrail.push({ x: this.player.x, y: this.player.y });
      if (this.playerTrail.length > 26) this.playerTrail.shift();
    } else if (this.playerTrail.length > 0) {
      this.playerTrail.shift();
    }

    if (this.loopTime >= this.nextSampleTime) {
      this.activeSamples.push({
        t: Number(this.loopTime.toFixed(3)),
        x: Number(this.player.x.toFixed(3)),
        y: Number(this.player.y.toFixed(3)),
      });
      this.nextSampleTime += SAMPLE_INTERVAL;
    }

    // Evaluate plates, gates, lasers, shards, and Temporal Core
    this.evaluateChamberState(true);
    if (this.phase !== 'playing') return;

    // Loop timer expiration
    if (this.loopTime >= this.chamber.loopDuration) {
      if (this.activeCloneIndex < MAX_CLONES - 1) {
        this.commitCurrentCloneAndRewind();
      } else {
        this.triggerFail('Time ran out on Clone γ! Tap Reset to try a faster route.');
      }
      return;
    }

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.08) {
      this.hudEmitAccum = 0;
      this.emitSnapshot();
    }
  }

  private resolvePlayerCollisions(): void {
    const obstacles: WallRect[] = [...this.chamber.walls];
    for (const gate of this.chamber.gates) {
      if (!this.isGateOpen(gate)) {
        obstacles.push({ x: gate.x, y: gate.y, w: gate.w, h: gate.h });
      }
    }

    for (let iter = 0; iter < 2; iter++) {
      for (const rect of obstacles) {
        const cx = Math.max(rect.x, Math.min(this.player.x, rect.x + rect.w));
        const cy = Math.max(rect.y, Math.min(this.player.y, rect.y + rect.h));
        const dx = this.player.x - cx;
        const dy = this.player.y - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq < PLAYER_R * PLAYER_R) {
          const dist = Math.sqrt(distSq);
          if (dist > 0.0001) {
            const push = PLAYER_R - dist;
            this.player.x += (dx / dist) * push;
            this.player.y += (dy / dist) * push;
          } else {
            this.player.x -= 0.05;
          }
        }
      }
    }

    // Clamp inside outer bounds
    this.player.x = Math.max(0.5 + PLAYER_R, Math.min(WORLD_W - 0.5 - PLAYER_R, this.player.x));
    this.player.y = Math.max(0.5 + PLAYER_R, Math.min(WORLD_H - 0.5 - PLAYER_R, this.player.y));
  }

  private isGateOpen(gate: GateDoor): boolean {
    return gate.requiredChannels.every((ch) => this.activeChannels[ch]);
  }

  private evaluateChamberState(liveGameplay: boolean): void {
    const pastClones = this.getPastClonePositions();
    const allActors: Vec2[] = liveGameplay
      ? [this.player, ...pastClones.map((c) => ({ x: c.x, y: c.y }))]
      : pastClones.map((c) => ({ x: c.x, y: c.y }));

    // 1. Pressure plates
    const nextChannels: Record<ChannelId, boolean> = { cyan: false, magenta: false, gold: false };
    for (const plate of this.chamber.plates) {
      const pressed = allActors.some(
        (a) => Math.hypot(a.x - plate.x, a.y - plate.y) <= plate.r + PLAYER_R * 0.65
      );
      if (pressed) {
        nextChannels[plate.channel] = true;
      }
    }

    if (liveGameplay) {
      (['cyan', 'magenta', 'gold'] as ChannelId[]).forEach((ch) => {
        if (nextChannels[ch] && !this.prevChannels[ch]) {
          this.audio.playPlateOn();
          this.haptic(14);
          this.timelineEvents.push({
            cloneIndex: this.activeCloneIndex,
            t: this.loopTime,
            kind: 'plate',
          });
        }
      });
    }
    this.prevChannels = { ...nextChannels };
    this.activeChannels = nextChannels;

    // 2. Raycast lasers (blocked by walls, closed gates, AND past clones!)
    const solidRects: WallRect[] = [...this.chamber.walls];
    for (const gate of this.chamber.gates) {
      if (!this.isGateOpen(gate)) {
        solidRects.push({ x: gate.x, y: gate.y, w: gate.w, h: gate.h });
      }
    }

    this.activeLaserRays = [];
    for (const laser of this.chamber.lasers) {
      const disabled = laser.disabledBy ? this.activeChannels[laser.disabledBy] : false;
      if (disabled) {
        this.activeLaserRays.push({
          id: laser.id,
          active: false,
          x1: laser.x,
          y1: laser.y,
          x2: laser.x,
          y2: laser.y,
          blockedByClone: false,
        });
        continue;
      }

      let bestDist = 20;
      let blockedByClone = false;

      // Intersect walls & closed gates
      for (const rect of solidRects) {
        const hit = this.rayIntersectRect(laser.x, laser.y, laser.dx, laser.dy, rect);
        if (hit !== null && hit > 0.08 && hit < bestDist) {
          bestDist = hit;
        }
      }

      // Intersect past clones (energy shield blocks laser!)
      if (laser.blockableByClone) {
        for (const pc of pastClones) {
          const hit = this.rayIntersectCircle(laser.x, laser.y, laser.dx, laser.dy, pc.x, pc.y, PLAYER_R + 0.14);
          if (hit !== null && hit > 0.05 && hit < bestDist) {
            bestDist = hit;
            blockedByClone = true;
          }
        }
      }

      const x2 = laser.x + laser.dx * bestDist;
      const y2 = laser.y + laser.dy * bestDist;

      if (blockedByClone && liveGameplay) {
        if (this.animTime - this.lastLaserBlockSound > 0.45) {
          this.lastLaserBlockSound = this.animTime;
          this.audio.playLaserBlock();
          this.timelineEvents.push({
            cloneIndex: this.activeCloneIndex,
            t: this.loopTime,
            kind: 'laser_block',
          });
        }
        if (Math.random() < 0.35) {
          this.spawnBurst(x2, y2, '#38bdf8', 2);
        }
      }

      this.activeLaserRays.push({
        id: laser.id,
        active: true,
        x1: laser.x,
        y1: laser.y,
        x2,
        y2,
        blockedByClone,
      });

      // Check active player collision with active laser segment
      if (liveGameplay) {
        const distToBeam = this.pointToSegmentDist(this.player.x, this.player.y, laser.x, laser.y, x2, y2);
        if (distToBeam < PLAYER_R * 0.85) {
          this.triggerFail('Vaporized by photon laser! Block it with a past clone or disable its circuit.');
          return;
        }
      }
    }

    if (!liveGameplay) return;

    // 3. Collect Chrono-Shards
    for (const shard of this.chamber.shards) {
      if (this.collectedShardIds.has(shard.id)) continue;
      if (Math.hypot(this.player.x - shard.x, this.player.y - shard.y) <= shard.r + PLAYER_R) {
        this.collectedShardIds.add(shard.id);
        this.audio.playShard();
        this.haptic(12);
        this.spawnBurst(shard.x, shard.y, '#fbbf24', 16);
        this.timelineEvents.push({
          cloneIndex: this.activeCloneIndex,
          t: this.loopTime,
          kind: 'shard',
        });
      }
    }

    // 4. Reach Temporal Core!
    if (
      Math.hypot(this.player.x - this.chamber.core.x, this.player.y - this.chamber.core.y) <=
      this.chamber.core.r + PLAYER_R * 0.85
    ) {
      this.triggerVictory();
    }
  }

  private rayIntersectRect(ox: number, oy: number, dx: number, dy: number, r: WallRect): number | null {
    const invX = dx !== 0 ? 1 / dx : Infinity;
    const invY = dy !== 0 ? 1 / dy : Infinity;
    const tx1 = (r.x - ox) * invX;
    const tx2 = (r.x + r.w - ox) * invX;
    const ty1 = (r.y - oy) * invY;
    const ty2 = (r.y + r.h - oy) * invY;
    const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2));
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));
    if (tmax < 0 || tmin > tmax) return null;
    return tmin >= 0 ? tmin : tmax;
  }

  private rayIntersectCircle(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    cx: number,
    cy: number,
    radius: number
  ): number | null {
    const fx = ox - cx;
    const fy = oy - cy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / 2;
    return t >= 0 ? t : null;
  }

  private pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const lenSq = vx * vx + vy * vy;
    if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / lenSq));
    return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
  }

  private spawnBurst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.2 + Math.random() * 4.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        color,
        size: 2 + Math.random() * 2.5,
      });
    }
  }

  private buildTimelineText(): string {
    const clonesCount = this.activeCloneIndex + 1;
    const lines: string[] = [];
    for (let c = 0; c < clonesCount; c++) {
      const slots = new Array<string>(8).fill('━');
      const events = this.timelineEvents.filter((e) => e.cloneIndex === c);
      for (const ev of events) {
        const idx = Math.min(7, Math.max(0, Math.floor((ev.t / LOOP_DURATION) * 8)));
        if (ev.kind === 'core') slots[idx] = '🎯';
        else if (ev.kind === 'laser_block' && slots[idx] === '━') slots[idx] = '🛡️';
        else if (ev.kind === 'plate' && slots[idx] === '━') slots[idx] = '🔘';
        else if (ev.kind === 'shard' && slots[idx] === '━') slots[idx] = '◆';
      }
      const badge = CLONE_COLORS[c].emoji;
      const suffix =
        c === 0 && this.borrowedCloneOwner ? ` (u/${this.borrowedCloneOwner})` : '';
      lines.push(`${badge} [${slots.join('')}]${suffix}`);
    }
    return lines.join('\n');
  }

  private render(): void {
    const ctx = this.ctx;
    const w = this.canvasW;
    const h = this.canvasH;

    // Background deep midnight navy gradient
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    bg.addColorStop(0, '#0d1530');
    bg.addColorStop(1, '#050812');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake * 18 : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake * 18 : 0;
    ctx.translate(this.viewOffsetX + shakeX, this.viewOffsetY + shakeY);

    const s = this.viewScale;

    // Chamber floor & pulsing architectural grid
    ctx.fillStyle = 'rgba(10, 16, 36, 0.92)';
    ctx.fillRect(0, 0, WORLD_W * s, WORLD_H * s);

    const gridPulse = 0.06 + Math.sin(this.animTime * 2.2) * 0.02;
    ctx.strokeStyle = `rgba(56, 189, 248, ${gridPulse})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= WORLD_W; gx++) {
      ctx.moveTo(gx * s, 0);
      ctx.lineTo(gx * s, WORLD_H * s);
    }
    for (let gy = 0; gy <= WORLD_H; gy++) {
      ctx.moveTo(0, gy * s);
      ctx.lineTo(WORLD_W * s, gy * s);
    }
    ctx.stroke();

    // Circuit lines linking plates to gates
    for (const plate of this.chamber.plates) {
      const powered = this.activeChannels[plate.channel];
      const col = CHANNEL_HEX[plate.channel];
      for (const gate of this.chamber.gates) {
        if (!gate.requiredChannels.includes(plate.channel)) continue;
        ctx.save();
        ctx.strokeStyle = powered ? col : 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = powered ? 2.5 : 1.25;
        ctx.setLineDash(powered ? [] : [6, 6]);
        if (powered) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 10;
        }
        ctx.beginPath();
        ctx.moveTo(plate.x * s, plate.y * s);
        ctx.lineTo((gate.x + gate.w * 0.5) * s, (gate.y + gate.h * 0.5) * s);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Spawn pad
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.chamber.spawn.x * s, this.chamber.spawn.y * s, 0.55 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = `700 ${Math.max(9, Math.round(s * 0.22))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPAWN', this.chamber.spawn.x * s, (this.chamber.spawn.y + 0.85) * s);
    ctx.restore();

    // Pressure Plates
    for (const plate of this.chamber.plates) {
      const powered = this.activeChannels[plate.channel];
      const col = CHANNEL_HEX[plate.channel];
      ctx.save();
      ctx.beginPath();
      ctx.arc(plate.x * s, plate.y * s, plate.r * s, 0, Math.PI * 2);
      ctx.fillStyle = powered ? `${col}44` : `${col}16`;
      ctx.fill();
      ctx.lineWidth = powered ? 3 : 2;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = powered ? 18 : 6;
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = powered ? '#ffffff' : col;
      ctx.font = `800 ${Math.max(12, Math.round(s * 0.42))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(plate.label, plate.x * s, plate.y * s);
      ctx.restore();
    }

    // Temporal Core (Goal)
    {
      const core = this.chamber.core;
      const pulse = 1 + Math.sin(this.animTime * 4.5) * 0.08;
      ctx.save();
      ctx.translate(core.x * s, core.y * s);
      ctx.rotate(this.animTime * 0.9);
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 24;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      const rr = core.r * s * pulse;
      ctx.strokeRect(-rr * 0.72, -rr * 0.72, rr * 1.44, rr * 1.44);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
      ctx.fillRect(-rr * 0.62, -rr * 0.62, rr * 1.24, rr * 1.24);
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2;
      ctx.strokeRect(-rr * 0.62, -rr * 0.62, rr * 1.24, rr * 1.24);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#fef08a';
      ctx.font = `800 ${Math.max(9, Math.round(s * 0.22))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('CORE', core.x * s, (core.y + 0.95) * s);
      ctx.restore();
    }

    // Chrono-Shards
    for (const shard of this.chamber.shards) {
      if (this.collectedShardIds.has(shard.id)) continue;
      const bob = Math.sin(this.animTime * 4 + shard.x) * 3;
      ctx.save();
      ctx.translate(shard.x * s, shard.y * s + bob);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#fde047';
      const sz = shard.r * s * 0.75;
      ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
      ctx.restore();
    }

    // Walls
    ctx.save();
    ctx.fillStyle = '#141e3d';
    ctx.strokeStyle = 'rgba(99, 179, 237, 0.35)';
    ctx.lineWidth = 1.5;
    for (const wall of this.chamber.walls) {
      ctx.fillRect(wall.x * s, wall.y * s, wall.w * s, wall.h * s);
      ctx.strokeRect(wall.x * s, wall.y * s, wall.w * s, wall.h * s);
    }
    ctx.restore();

    // Gates (solid neon laser barrier when closed, subtle outline when open)
    for (const gate of this.chamber.gates) {
      const open = this.isGateOpen(gate);
      const col = CHANNEL_HEX[gate.color];
      ctx.save();
      if (open) {
        ctx.strokeStyle = `${col}44`;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(gate.x * s, gate.y * s, gate.w * s, gate.h * s);
      } else {
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `${col}aa`;
        ctx.fillRect(gate.x * s, gate.y * s, gate.w * s, gate.h * s);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(gate.x * s, gate.y * s, gate.w * s, gate.h * s);
      }
      ctx.restore();
    }

    // Lasers
    for (const ray of this.activeLaserRays) {
      // Emitter node
      ctx.save();
      ctx.fillStyle = ray.active ? '#ff2a5f' : '#475569';
      ctx.beginPath();
      ctx.arc(ray.x1 * s, ray.y1 * s, 0.22 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (!ray.active) continue;
      ctx.save();
      ctx.strokeStyle = '#ff2a5f';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#ff2a5f';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(ray.x1 * s, ray.y1 * s);
      ctx.lineTo(ray.x2 * s, ray.y2 * s);
      ctx.stroke();

      ctx.strokeStyle = '#ffd1dc';
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(ray.x1 * s, ray.y1 * s);
      ctx.lineTo(ray.x2 * s, ray.y2 * s);
      ctx.stroke();

      if (ray.blockedByClone) {
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(ray.x2 * s, ray.y2 * s, 0.16 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Past Clones (Echo Ghosts) + their faint paths
    const pastClones = this.getPastClonePositions();
    for (const rec of this.recordings) {
      const style = CLONE_COLORS[rec.index];
      if (rec.samples.length >= 2) {
        ctx.save();
        ctx.strokeStyle = `${style.hex}33`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rec.samples[0].x * s, rec.samples[0].y * s);
        for (let i = 1; i < rec.samples.length; i += 2) {
          ctx.lineTo(rec.samples[i].x * s, rec.samples[i].y * s);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const pc of pastClones) {
      const style = CLONE_COLORS[pc.index];
      this.drawCloneOrb(pc.x * s, pc.y * s, PLAYER_R * s, style.hex, style.symbol, true, pc.borrowedFrom);
    }

    // Active Player Trail & Orb
    const activeStyle = CLONE_COLORS[this.activeCloneIndex];
    if (this.playerTrail.length >= 2 && this.phase === 'playing') {
      ctx.save();
      for (let i = 1; i < this.playerTrail.length; i++) {
        const alpha = i / this.playerTrail.length;
        ctx.strokeStyle = `${activeStyle.hex}${Math.round(alpha * 140)
          .toString(16)
          .padStart(2, '0')}`;
        ctx.lineWidth = alpha * PLAYER_R * s * 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this.playerTrail[i - 1].x * s, this.playerTrail[i - 1].y * s);
        ctx.lineTo(this.playerTrail[i].x * s, this.playerTrail[i].y * s);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.phase === 'playing' || this.phase === 'title') {
      this.drawCloneOrb(
        this.player.x * s,
        this.player.y * s,
        PLAYER_R * s,
        activeStyle.hex,
        activeStyle.symbol,
        false
      );
    }

    // Particles
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Rewind shockwave ring
    if (this.rewindWave > 0.01) {
      ctx.save();
      const prog = 1 - this.rewindWave;
      ctx.strokeStyle = `rgba(56, 189, 248, ${this.rewindWave * 0.7})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(
        this.chamber.spawn.x * s,
        this.chamber.spawn.y * s,
        prog * WORLD_W * s * 0.85,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // Virtual 1-Thumb Joystick overlay (screen space)
    if (this.pointerActive && this.phase === 'playing') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.joyOrigin.x, this.joyOrigin.y, 44, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `${activeStyle.hex}99`;
      ctx.shadowColor = activeStyle.hex;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(this.joyCurrent.x, this.joyCurrent.y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCloneOrb(
    px: number,
    py: number,
    r: number,
    hex: string,
    symbol: string,
    isGhost: boolean,
    borrowedFrom?: string
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = hex;
    ctx.shadowBlur = isGhost ? 14 : 22;

    // Outer energy shield ring
    ctx.beginPath();
    ctx.arc(px, py, r * (isGhost ? 1.15 : 1.0), 0, Math.PI * 2);
    ctx.fillStyle = isGhost ? `${hex}38` : hex;
    ctx.fill();
    ctx.lineWidth = isGhost ? 2.5 : 2;
    ctx.strokeStyle = isGhost ? hex : '#ffffff';
    ctx.stroke();

    // Symbol inside orb
    ctx.shadowBlur = 0;
    ctx.fillStyle = isGhost ? '#ffffff' : '#050812';
    ctx.font = `800 ${Math.max(11, Math.round(r * 1.1))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, px, py + 0.5);

    if (borrowedFrom) {
      ctx.fillStyle = '#bae6fd';
      ctx.font = `700 ${Math.max(9, Math.round(r * 0.65))}px system-ui, sans-serif`;
      ctx.fillText(`u/${borrowedFrom}`, px, py - r * 1.6);
    }
    ctx.restore();
  }

  private haptic(pattern: number | number[]): void {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore
      }
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) {
        if (this.phase === 'title') this.startDaily();
        else if (this.phase === 'playing') this.lockAndNextClone();
        else if (this.phase === 'failed' || this.phase === 'victory') this.restartChamber();
      }
      if (e.code === 'KeyR' && !e.repeat && this.phase !== 'title') {
        this.restartChamber();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (this.phase !== 'playing') return;
      this.pointerActive = true;
      this.pointerId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyCurrent = { x: e.clientX, y: e.clientY };
      this.joyVec = { x: 0, y: 0 };
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerActive || e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const maxR = 44;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, maxR);
      const ang = Math.atan2(dy, dx);
      this.joyCurrent = {
        x: this.joyOrigin.x + Math.cos(ang) * clamped,
        y: this.joyOrigin.y + Math.sin(ang) * clamped,
      };
      this.joyVec = dist > 5 ? { x: (Math.cos(ang) * clamped) / maxR, y: (Math.sin(ang) * clamped) / maxR } : { x: 0, y: 0 };
    });

    const releasePointer = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerActive = false;
      this.pointerId = null;
      this.joyVec = { x: 0, y: 0 };
    };
    this.canvas.addEventListener('pointerup', releasePointer);
    this.canvas.addEventListener('pointercancel', releasePointer);
  }

  private handleResize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvasW = window.innerWidth;
    this.canvasH = window.innerHeight;
    this.canvas.width = Math.floor(this.canvasW * dpr);
    this.canvas.height = Math.floor(this.canvasH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Reserve safe top/bottom padding for minimal HUD bars
    const padX = Math.max(12, this.canvasW * 0.03);
    const padTop = 76;
    const padBottom = 84;
    const availW = Math.max(200, this.canvasW - padX * 2);
    const availH = Math.max(160, this.canvasH - padTop - padBottom);
    this.viewScale = Math.min(availW / WORLD_W, availH / WORLD_H);
    this.viewOffsetX = (this.canvasW - WORLD_W * this.viewScale) * 0.5;
    this.viewOffsetY = padTop + (availH - WORLD_H * this.viewScale) * 0.5;
  };

  private emitSnapshot(): void {
    const clonesUsed = this.activeCloneIndex + 1;
    this.onSnapshot({
      phase: this.phase,
      seed: this.seed,
      isDailyMode: this.isDailyMode,
      chamberTitle: this.chamber.title,
      chamberSubtitle: this.chamber.subtitle,
      chamberHint: this.chamber.hint,
      activeCloneIndex: this.activeCloneIndex,
      maxClones: MAX_CLONES,
      loopTimeLeft: Math.max(0, this.chamber.loopDuration - this.loopTime),
      loopDuration: this.chamber.loopDuration,
      totalElapsed: this.totalElapsed,
      clearTimeMs: this.clearTimeMs,
      clonesUsed,
      shardsCollected: this.collectedShardIds.size,
      totalShards: this.chamber.shards.length,
      paradoxBonus: this.clearTimeMs !== null && clonesUsed <= 2,
      failReason: this.failReason,
      borrowedCloneOwner: this.borrowedCloneOwner,
      availableCommunityClones: this.availableCommunityClones,
      streak: this.streak,
      bestTimeMs: this.bestTimeMs,
      redditConnected: this.redditConnected,
      redditUsername: this.redditUsername,
      subredditName: this.subredditName,
      dailySolvers: this.dailySolvers,
      leaderboard: this.leaderboard,
      playerRank: this.playerRank,
      timelineText: this.buildTimelineText(),
      activeChannels: { ...this.activeChannels },
    });
  }
}
