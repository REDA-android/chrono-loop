export type GamePhase = 'title' | 'playing' | 'rewinding' | 'victory' | 'failed';

export type ChannelId = 'cyan' | 'magenta' | 'gold';

export interface Vec2 {
  x: number;
  y: number;
}

export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PressurePlate {
  id: string;
  x: number;
  y: number;
  r: number;
  channel: ChannelId;
  label: string;
}

export interface GateDoor {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  requiredChannels: ChannelId[];
  color: ChannelId;
}

export interface LaserEmitter {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Optional channel that disables this laser when held */
  disabledBy?: ChannelId;
  /** Whether a past clone's energy shield physically blocks this beam */
  blockableByClone: boolean;
}

export interface ChronoShard {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface DailyChamber {
  seed: string;
  title: string;
  subtitle: string;
  archetype: string;
  width: number;
  height: number;
  loopDuration: number;
  maxClones: number;
  spawn: Vec2;
  core: { x: number; y: number; r: number };
  walls: WallRect[];
  plates: PressurePlate[];
  gates: GateDoor[];
  lasers: LaserEmitter[];
  shards: ChronoShard[];
  hint: string;
}

export interface CloneSample {
  t: number;
  x: number;
  y: number;
}

export interface CloneRecording {
  index: number; // 0 = alpha, 1 = beta, 2 = gamma
  samples: CloneSample[];
  duration: number;
  borrowedFrom?: string;
}

export interface TimelineEvent {
  cloneIndex: number;
  t: number;
  kind: 'plate' | 'laser_block' | 'shard' | 'gate' | 'core';
}

export interface LeaderboardEntry {
  username: string;
  timeMs: number;
  clonesUsed: number;
  shards: number;
  score: number;
  rank: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  seed: string;
  isDailyMode: boolean;
  chamberTitle: string;
  chamberSubtitle: string;
  chamberHint: string;
  activeCloneIndex: number; // 0, 1, 2
  maxClones: number;
  loopTimeLeft: number;
  loopDuration: number;
  totalElapsed: number;
  clearTimeMs: number | null;
  clonesUsed: number;
  shardsCollected: number;
  totalShards: number;
  paradoxBonus: boolean;
  failReason: string | null;
  borrowedCloneOwner: string | null;
  availableCommunityClones: number;
  streak: number;
  bestTimeMs: number | null;
  redditConnected: boolean;
  redditUsername: string | null;
  subredditName: string | null;
  dailySolvers: number;
  leaderboard: LeaderboardEntry[];
  playerRank: number | null;
  timelineText: string;
  activeChannels: Record<ChannelId, boolean>;
}

export const CLONE_COLORS: ReadonlyArray<{
  name: string;
  symbol: string;
  hex: string;
  glow: string;
  emoji: string;
}> = [
  { name: 'Clone α', symbol: 'α', hex: '#38bdf8', glow: 'rgba(56, 189, 248, 0.55)', emoji: '🔵' },
  { name: 'Clone β', symbol: 'β', hex: '#e879f9', glow: 'rgba(232, 121, 249, 0.55)', emoji: '🟣' },
  { name: 'Clone γ', symbol: 'γ', hex: '#fbbf24', glow: 'rgba(251, 191, 36, 0.55)', emoji: '🟠' },
];

export const CHANNEL_HEX: Record<ChannelId, string> = {
  cyan: '#38bdf8',
  magenta: '#e879f9',
  gold: '#fbbf24',
};

export function getUtcDateString(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeScore(timeMs: number, clonesUsed: number, shards: number): number {
  // Higher is better for Redis ZSET ranking
  const speedBonus = Math.max(0, 35000 - Math.floor(timeMs));
  const cloneBonus = (4 - Math.min(3, Math.max(1, clonesUsed))) * 5000;
  const shardBonus = shards * 1500;
  return speedBonus + cloneBonus + shardBonus;
}
