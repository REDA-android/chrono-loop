import { CloneSample, LeaderboardEntry } from './types';

export interface InitResponse {
  ok: true;
  username: string;
  isGuest: boolean;
  subredditName: string;
  postId: string;
  seed: string;
  streak: number;
  bestTimeMs: number | null;
  dailySolvers: number;
  availableCommunityClones: number;
  leaderboard: LeaderboardEntry[];
  playerRank: number | null;
}

export interface SubmitClearPayload {
  seed: string;
  timeMs: number;
  clonesUsed: number;
  shards: number;
  alphaSamples?: CloneSample[];
}

export interface SubmitClearResponse {
  ok: true;
  streak: number;
  bestTimeMs: number;
  dailySolvers: number;
  availableCommunityClones: number;
  leaderboard: LeaderboardEntry[];
  playerRank: number | null;
}

export interface BorrowCloneResponse {
  ok: boolean;
  username?: string;
  samples?: CloneSample[];
  duration?: number;
  error?: string;
}

export interface ShareCommentPayload {
  seed: string;
  timeMs: number;
  clonesUsed: number;
  shards: number;
  timelineText: string;
  streak: number;
  borrowedFrom?: string | null;
}

export interface ShareCommentResponse {
  ok: boolean;
  alreadyShared?: boolean;
  error?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 4000): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchInit(seed: string): Promise<InitResponse | null> {
  const res = await fetchJson<InitResponse>(
    `/api/init?seed=${encodeURIComponent(seed)}`,
    { method: 'GET' },
    3000
  );
  return res?.ok ? res : null;
}

export async function submitClear(payload: SubmitClearPayload): Promise<SubmitClearResponse | null> {
  const res = await fetchJson<SubmitClearResponse>('/api/submit-clear', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res?.ok ? res : null;
}

export async function borrowCommunityClone(seed: string): Promise<BorrowCloneResponse> {
  const res = await fetchJson<BorrowCloneResponse>(
    `/api/borrow-clone?seed=${encodeURIComponent(seed)}`,
    { method: 'GET' }
  );
  return res ?? { ok: false, error: 'No community clones yet today' };
}

export async function shareTimelineComment(
  payload: ShareCommentPayload
): Promise<ShareCommentResponse> {
  const res = await fetchJson<ShareCommentResponse>('/api/share-comment', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res ?? { ok: false, error: 'Unable to reach Reddit server' };
}
