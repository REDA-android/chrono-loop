import type { IncomingMessage, ServerResponse } from 'node:http';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';

interface CloneSample {
  t: number;
  x: number;
  y: number;
}

interface StoredClearMeta {
  timeMs: number;
  clonesUsed: number;
  shards: number;
  score: number;
}

interface StoredCommunityClone {
  username: string;
  samples: CloneSample[];
  duration: number;
}

interface LeaderboardEntry {
  username: string;
  timeMs: number;
  clonesUsed: number;
  shards: number;
  score: number;
  rank: number;
}

function getUtcDateString(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sanitizeSeed(raw: string | null | undefined): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return getUtcDateString();
}

function computeScore(timeMs: number, clonesUsed: number, shards: number): number {
  const speedBonus = Math.max(0, 35000 - Math.floor(timeMs));
  const cloneBonus = (4 - Math.min(3, Math.max(1, clonesUsed))) * 5000;
  const shardBonus = Math.min(3, Math.max(0, shards)) * 1500;
  return speedBonus + cloneBonus + shardBonus;
}

function sanitizeSamples(raw: unknown): CloneSample[] {
  if (!Array.isArray(raw)) return [];
  const out: CloneSample[] = [];
  const limit = Math.min(raw.length, 320);
  for (let i = 0; i < limit; i++) {
    const s = raw[i] as Partial<CloneSample> | null;
    if (!s || typeof s !== 'object') continue;
    const t = Number(s.t);
    const x = Number(s.x);
    const y = Number(s.y);
    if (Number.isFinite(t) && Number.isFinite(x) && Number.isFinite(y)) {
      out.push({
        t: Math.round(t * 100) / 100,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
      });
    }
  }
  return out;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody<T>(req: IncomingMessage, maxBytes = 96 * 1024): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total <= maxBytes) chunks.push(buf);
    });
    req.on('end', () => {
      if (total === 0 || total > maxBytes) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const boardKey = (sub: string, seed: string) => `cl:lb:${sub}:${seed}`;
const metaKey = (sub: string, seed: string, user: string) => `cl:meta:${sub}:${seed}:${user}`;
const streakKey = (sub: string, user: string) => `cl:streak:${sub}:${user}`;
const clonePoolKey = (sub: string, seed: string) => `cl:pool:${sub}:${seed}`;
const shareGuardKey = (postId: string, seed: string, user: string) => `cl:shared:${postId}:${seed}:${user}`;

async function loadStreak(sub: string, user: string): Promise<{ count: number; lastDate: string | null }> {
  try {
    const raw = await redis.get(streakKey(sub, user));
    if (!raw) return { count: 0, lastDate: null };
    const parsed = JSON.parse(raw) as { count?: number; lastDate?: string };
    const today = getUtcDateString(0);
    const yesterday = getUtcDateString(-1);
    if (parsed.lastDate === today || parsed.lastDate === yesterday) {
      return {
        count: Math.max(0, Math.floor(Number(parsed.count) || 0)),
        lastDate: parsed.lastDate,
      };
    }
    return { count: 0, lastDate: null };
  } catch {
    return { count: 0, lastDate: null };
  }
}

async function loadLeaderboard(
  sub: string,
  seed: string,
  username: string | null
): Promise<{ leaderboard: LeaderboardEntry[]; playerRank: number | null; dailySolvers: number }> {
  const key = boardKey(sub, seed);
  try {
    const total = await redis.zCard(key);
    const top = await redis.zRange(key, 0, 9, { by: 'rank', reverse: true });
    const leaderboard: LeaderboardEntry[] = [];

    for (let i = 0; i < top.length; i++) {
      const entry = top[i];
      let timeMs = 0;
      let clonesUsed = 3;
      let shards = 0;
      try {
        const mRaw = await redis.get(metaKey(sub, seed, entry.member));
        if (mRaw) {
          const parsed = JSON.parse(mRaw) as Partial<StoredClearMeta>;
          timeMs = Number(parsed.timeMs) || 0;
          clonesUsed = Number(parsed.clonesUsed) || 3;
          shards = Number(parsed.shards) || 0;
        }
      } catch {
        // Ignore meta parse issues
      }
      leaderboard.push({
        username: entry.member,
        timeMs,
        clonesUsed,
        shards,
        score: Math.floor(entry.score),
        rank: i + 1,
      });
    }

    let playerRank: number | null = null;
    if (username) {
      const found = leaderboard.find((e) => e.username === username);
      if (found) {
        playerRank = found.rank;
      } else if (total > 0) {
        const ascRank = await redis.zRank(key, username);
        if (ascRank !== undefined) {
          playerRank = total - ascRank;
        }
      }
    }

    return { leaderboard, playerRank, dailySolvers: total };
  } catch {
    return { leaderboard: [], playerRank: null, dailySolvers: 0 };
  }
}

async function loadClonePool(sub: string, seed: string): Promise<StoredCommunityClone[]> {
  try {
    const raw = await redis.get(clonePoolKey(sub, seed));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCommunityClone[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function createDailyPost(): Promise<{ id: string; url?: string }> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error('Missing subredditName in Devvit context');
  }
  const today = getUtcDateString();
  const post = await reddit.submitCustomPost({
    subredditName,
    title: `CHRONO LOOP — Daily Time Chamber (${today})`,
    entry: 'default',
  });
  return { id: post.id, url: post.url };
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? 'GET';
  const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
  const pathname = parsedUrl.pathname;

  try {
    if (pathname === '/internal/on-app-install' && method === 'POST') {
      const post = await createDailyPost();
      sendJson(res, 200, { status: 'success', postId: post.id });
      return;
    }

    if (pathname === '/internal/menu/post-create' && method === 'POST') {
      const post = await createDailyPost();
      sendJson(res, 200, {
        navigateTo: post.url ?? `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
        showToast: {
          text: 'CHRONO LOOP Daily Post created!',
          appearance: 'success',
        },
      });
      return;
    }

    if (pathname === '/api/init' && method === 'GET') {
      const seed = sanitizeSeed(parsedUrl.searchParams.get('seed'));
      const sub = context.subredditName ?? 'chronoloop';
      const postId = context.postId ?? '';

      let username: string | undefined;
      try {
        username = await reddit.getCurrentUsername();
      } catch {
        username = undefined;
      }
      const isGuest = !username;

      let streak = 0;
      let bestTimeMs: number | null = null;
      if (username) {
        const s = await loadStreak(sub, username);
        streak = s.count;
        try {
          const mRaw = await redis.get(metaKey(sub, seed, username));
          if (mRaw) {
            const parsed = JSON.parse(mRaw) as Partial<StoredClearMeta>;
            if (Number.isFinite(parsed.timeMs) && Number(parsed.timeMs) > 0) {
              bestTimeMs = Number(parsed.timeMs);
            }
          }
        } catch {
          bestTimeMs = null;
        }
      }

      const { leaderboard, playerRank, dailySolvers } = await loadLeaderboard(
        sub,
        seed,
        username ?? null
      );
      const pool = await loadClonePool(sub, seed);
      const availableCommunityClones = username
        ? pool.filter((c) => c.username !== username).length
        : pool.length;

      sendJson(res, 200, {
        ok: true,
        username: username ?? 'Guest',
        isGuest,
        subredditName: sub,
        postId,
        seed,
        streak,
        bestTimeMs,
        dailySolvers,
        availableCommunityClones,
        leaderboard,
        playerRank,
      });
      return;
    }

    if (pathname === '/api/submit-clear' && method === 'POST') {
      const body = await readJsonBody<{
        seed?: string;
        timeMs?: number;
        clonesUsed?: number;
        shards?: number;
        alphaSamples?: CloneSample[];
      }>(req);

      if (!body) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
        return;
      }

      const sub = context.subredditName ?? 'chronoloop';
      const seed = sanitizeSeed(body.seed);
      const timeMs = Math.max(500, Math.min(35000, Math.floor(Number(body.timeMs) || 30000)));
      const clonesUsed = Math.max(1, Math.min(3, Math.floor(Number(body.clonesUsed) || 3)));
      const shards = Math.max(0, Math.min(3, Math.floor(Number(body.shards) || 0)));
      const score = computeScore(timeMs, clonesUsed, shards);

      let username: string | undefined;
      try {
        username = await reddit.getCurrentUsername();
      } catch {
        username = undefined;
      }

      if (!username) {
        const { leaderboard, dailySolvers } = await loadLeaderboard(sub, seed, null);
        const pool = await loadClonePool(sub, seed);
        sendJson(res, 200, {
          ok: true,
          streak: 0,
          bestTimeMs: timeMs,
          dailySolvers,
          availableCommunityClones: pool.length,
          leaderboard,
          playerRank: null,
        });
        return;
      }

      // Update Daily Streak
      const today = getUtcDateString(0);
      const yesterday = getUtcDateString(-1);
      const prevStreak = await loadStreak(sub, username);
      let newStreak = 1;
      if (prevStreak.lastDate === today) {
        newStreak = Math.max(1, prevStreak.count);
      } else if (prevStreak.lastDate === yesterday) {
        newStreak = prevStreak.count + 1;
      }
      await redis.set(streakKey(sub, username), JSON.stringify({ count: newStreak, lastDate: today }));

      // Update daily leaderboard if better score
      const bKey = boardKey(sub, seed);
      const prevScore = await redis.zScore(bKey, username);
      let bestTimeMs = timeMs;
      if (prevScore === undefined || score > prevScore) {
        await redis.zAdd(bKey, { member: username, score });
        await redis.set(
          metaKey(sub, seed, username),
          JSON.stringify({ timeMs, clonesUsed, shards, score })
        );
      } else {
        try {
          const mRaw = await redis.get(metaKey(sub, seed, username));
          if (mRaw) {
            const parsed = JSON.parse(mRaw) as Partial<StoredClearMeta>;
            if (Number.isFinite(parsed.timeMs)) bestTimeMs = Number(parsed.timeMs);
          }
        } catch {
          // Keep current timeMs
        }
      }

      // Save Clone α into the Subreddit Async Co-op Ghost Pool (capped to 16 recent winners)
      const alphaSamples = sanitizeSamples(body.alphaSamples);
      let pool = await loadClonePool(sub, seed);
      if (alphaSamples.length >= 4) {
        const duration = alphaSamples[alphaSamples.length - 1].t;
        pool = pool.filter((c) => c.username !== username);
        pool.unshift({ username, samples: alphaSamples, duration });
        if (pool.length > 16) pool = pool.slice(0, 16);
        await redis.set(clonePoolKey(sub, seed), JSON.stringify(pool));
      }

      const { leaderboard, playerRank, dailySolvers } = await loadLeaderboard(sub, seed, username);
      const availableCommunityClones = pool.filter((c) => c.username !== username).length;

      sendJson(res, 200, {
        ok: true,
        streak: newStreak,
        bestTimeMs,
        dailySolvers,
        availableCommunityClones,
        leaderboard,
        playerRank,
      });
      return;
    }

    if (pathname === '/api/borrow-clone' && method === 'GET') {
      const seed = sanitizeSeed(parsedUrl.searchParams.get('seed'));
      const sub = context.subredditName ?? 'chronoloop';
      let username: string | undefined;
      try {
        username = await reddit.getCurrentUsername();
      } catch {
        username = undefined;
      }

      const pool = await loadClonePool(sub, seed);
      const candidates = username ? pool.filter((c) => c.username !== username) : pool;
      if (candidates.length === 0) {
        sendJson(res, 200, { ok: false, error: 'Be the first to clear today to seed the Clone Pool!' });
        return;
      }

      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      sendJson(res, 200, {
        ok: true,
        username: picked.username,
        samples: picked.samples,
        duration: picked.duration,
      });
      return;
    }

    if (pathname === '/api/share-comment' && method === 'POST') {
      const body = await readJsonBody<{
        seed?: string;
        timeMs?: number;
        clonesUsed?: number;
        shards?: number;
        timelineText?: string;
        streak?: number;
        borrowedFrom?: string | null;
      }>(req);

      if (!body || !context.postId) {
        sendJson(res, 400, { ok: false, error: 'Missing post context' });
        return;
      }

      let username: string | undefined;
      try {
        username = await reddit.getCurrentUsername();
      } catch {
        username = undefined;
      }
      if (!username) {
        sendJson(res, 401, { ok: false, error: 'Sign in to Reddit to post your timeline' });
        return;
      }

      const seed = sanitizeSeed(body.seed);
      const timeMs = Math.max(500, Math.floor(Number(body.timeMs) || 0));
      const clonesUsed = Math.max(1, Math.min(3, Math.floor(Number(body.clonesUsed) || 3)));
      const shards = Math.max(0, Math.min(3, Math.floor(Number(body.shards) || 0)));
      const streak = Math.max(0, Math.floor(Number(body.streak) || 0));
      const timelineText =
        typeof body.timelineText === 'string' ? body.timelineText.slice(0, 420) : '';

      const guardKey = shareGuardKey(context.postId, seed, username);
      const prevBestRaw = await redis.get(guardKey);
      if (prevBestRaw && Number(prevBestRaw) <= timeMs) {
        sendJson(res, 200, { ok: true, alreadyShared: true });
        return;
      }

      const sec = (timeMs / 1000).toFixed(2);
      const paradoxTag = clonesUsed <= 2 ? ' ⚡ PARADOX CLEAR' : '';
      const shardIcons = '◆'.repeat(shards) + '◇'.repeat(3 - shards);
      const streakBit = streak > 0 ? ` · 🔥 ${streak}d Streak` : '';
      const coopBit =
        body.borrowedFrom && typeof body.borrowedFrom === 'string'
          ? `\n\n🤝 Async Co-op with u/${body.borrowedFrom.slice(0, 32)}`
          : '';

      const commentText = [
        `**⏱️ CHRONO LOOP #${seed}** — Cleared in **${sec}s** (${clonesUsed}/3 Clones${paradoxTag}) · Shards ${shardIcons}${streakBit}`,
        timelineText ? `\`\`\`\n${timelineText}\n\`\`\`` : '',
        `Can you bend time faster? Hit Play above!${coopBit}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      await reddit.submitComment({
        id: context.postId,
        text: commentText,
        runAs: 'USER',
      });

      await redis.set(guardKey, String(timeMs));
      sendJson(res, 200, { ok: true, alreadyShared: false });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
});

server.listen(getServerPort());
