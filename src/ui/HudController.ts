import { ChronoAudio } from '../game/audio';
import { ChronoEngine } from '../game/ChronoEngine';
import { CLONE_COLORS, GamePhase, GameSnapshot } from '../game/types';

export class HudController {
  private root: HTMLElement;
  private engine: ChronoEngine;
  private audio: ChronoAudio;
  private lastPhase: GamePhase | null = null;
  private lastCloneIdx = -1;
  private lastBorrowed: string | null = null;
  private toastMessage: string | null = null;
  private toastTimer = 0;

  private timerValEl: HTMLElement | null = null;
  private timerFillEl: HTMLElement | null = null;
  private shardEl: HTMLElement | null = null;

  constructor(root: HTMLElement, engine: ChronoEngine, audio: ChronoAudio) {
    this.root = root;
    this.engine = engine;
    this.audio = audio;
  }

  public showToast(msg: string): void {
    this.toastMessage = msg;
    window.clearTimeout(this.toastTimer);
    const toastEl = this.root.querySelector<HTMLElement>('[data-toast="1"]');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastMessage = null;
      const el = this.root.querySelector<HTMLElement>('[data-toast="1"]');
      el?.classList.remove('show');
    }, 2600);
  }

  public update(snap: GameSnapshot): void {
    const needsShell =
      snap.phase !== this.lastPhase ||
      snap.activeCloneIndex !== this.lastCloneIdx ||
      snap.borrowedCloneOwner !== this.lastBorrowed;

    if (needsShell) {
      this.renderShell(snap);
      this.lastPhase = snap.phase;
      this.lastCloneIdx = snap.activeCloneIndex;
      this.lastBorrowed = snap.borrowedCloneOwner;
    }

    if (snap.phase === 'playing' || snap.phase === 'rewinding') {
      if (this.timerValEl) {
        this.timerValEl.textContent = `${snap.loopTimeLeft.toFixed(1)}s`;
        this.timerValEl.classList.toggle('urgent', snap.loopTimeLeft <= 3.0);
      }
      if (this.timerFillEl) {
        const pct = Math.max(0, Math.min(100, (snap.loopTimeLeft / snap.loopDuration) * 100));
        this.timerFillEl.style.width = `${pct}%`;
      }
      if (this.shardEl) {
        this.shardEl.textContent = `${'◆'.repeat(snap.shardsCollected)}${'◇'.repeat(
          Math.max(0, snap.totalShards - snap.shardsCollected)
        )}`;
      }
    }

    if (snap.phase === 'victory') {
      const lbHost = this.root.querySelector<HTMLElement>('[data-lb-host="1"]');
      if (lbHost) {
        lbHost.innerHTML = this.renderLeaderboard(snap);
      }
    }
  }

  private renderShell(snap: GameSnapshot): void {
    const muteLabel = this.audio.isMuted() ? '🔇' : '🔊';

    if (snap.phase === 'title') {
      const streakBadge = snap.streak > 0 ? `<span class="badge streak">🔥 ${snap.streak}d Streak</span>` : '';
      const solversBadge =
        snap.dailySolvers > 0
          ? `<span class="badge solvers">${snap.dailySolvers} Redditors cleared today</span>`
          : '';
      const bestBadge =
        snap.bestTimeMs !== null
          ? `<span class="badge best">Best ${(snap.bestTimeMs / 1000).toFixed(2)}s</span>`
          : '';

      this.root.innerHTML = `
        <div class="overlay">
          <div class="card glass">
            <div class="eyebrow">DAILY TIME CHAMBER · #${this.esc(snap.seed)}</div>
            <h1 class="title">CHRONO LOOP</h1>
            <div class="chamber-name">${this.esc(snap.chamberTitle)}</div>
            <p class="subtitle">${this.esc(snap.chamberSubtitle)}</p>
            ${streakBadge || solversBadge || bestBadge ? `<div class="badges">${streakBadge}${bestBadge}${solversBadge}</div>` : ''}
            <div class="how-grid">
              <div class="how-item"><span class="dot c0">α</span> Hold plates or block lasers</div>
              <div class="how-item"><span class="dot c1">β</span> Cooperate with your past self</div>
              <div class="how-item"><span class="dot c2">γ</span> Reach the Golden Core</div>
            </div>
            <div class="actions">
              <button type="button" class="btn primary" data-play="1">PLAY DAILY</button>
              <button type="button" class="btn ghost" data-practice="1">Yesterday's Loop</button>
            </div>
            <div class="hint">1-thumb drag on mobile · WASD / Arrows + Space on desktop</div>
          </div>
        </div>
      `;

      this.root.querySelector('[data-play="1"]')?.addEventListener('click', () => {
        this.engine.startDaily();
      });
      this.root.querySelector('[data-practice="1"]')?.addEventListener('click', () => {
        this.engine.startPracticeOffset(1);
      });
      return;
    }

    if (snap.phase === 'playing' || snap.phase === 'rewinding') {
      const activeStyle = CLONE_COLORS[snap.activeCloneIndex];
      const clonePills = CLONE_COLORS.map((c, idx) => {
        const state =
          idx < snap.activeCloneIndex
            ? 'done'
            : idx === snap.activeCloneIndex
              ? 'active'
              : 'pending';
        const tag =
          idx === 0 && snap.borrowedCloneOwner
            ? `u/${this.esc(snap.borrowedCloneOwner.slice(0, 10))}`
            : c.name;
        return `<div class="clone-pill ${state}" style="--c:${c.hex}">
          <span class="sym">${c.symbol}</span>
          <span class="lbl">${tag}</span>
        </div>`;
      }).join('');

      const nextLabel =
        snap.activeCloneIndex < snap.maxClones - 1
          ? `Lock ${activeStyle.symbol} → Next`
          : 'Final Clone γ';

      const coopBtn =
        snap.isDailyMode && snap.availableCommunityClones > 0 && !snap.borrowedCloneOwner
          ? `<button type="button" class="btn small coop" data-coop="1">Summon u/Clone (${snap.availableCommunityClones})</button>`
          : '';

      this.root.innerHTML = `
        <div class="top-bar">
          <div class="clones-row">${clonePills}</div>
          <div class="timer-box glass">
            <div class="timer-top">
              <span class="shards" data-shards="1">${'◆'.repeat(snap.shardsCollected)}${'◇'.repeat(Math.max(0, snap.totalShards - snap.shardsCollected))}</span>
              <span class="timer-val" data-timer-val="1">${snap.loopTimeLeft.toFixed(1)}s</span>
            </div>
            <div class="timer-track">
              <div class="timer-fill" data-timer-fill="1" style="width:${(snap.loopTimeLeft / snap.loopDuration) * 100}%;background:${activeStyle.hex}"></div>
            </div>
          </div>
          <button type="button" class="icon-btn glass" data-mute="1" aria-label="Toggle sound">${muteLabel}</button>
        </div>

        <div class="toast ${this.toastMessage ? 'show' : ''}" data-toast="1">${this.esc(this.toastMessage ?? '')}</div>

        <div class="bottom-bar">
          <div class="tip-line">${this.esc(snap.chamberHint)}</div>
          <div class="controls-row">
            <button type="button" class="btn small ghost" data-reset="1">Reset (R)</button>
            ${coopBtn}
            <button type="button" class="btn small primary" data-next="1" ${snap.activeCloneIndex >= snap.maxClones - 1 ? 'disabled' : ''}>${nextLabel}</button>
          </div>
        </div>
      `;

      this.timerValEl = this.root.querySelector('[data-timer-val="1"]');
      this.timerFillEl = this.root.querySelector('[data-timer-fill="1"]');
      this.shardEl = this.root.querySelector('[data-shards="1"]');

      this.root.querySelector('[data-mute="1"]')?.addEventListener('click', (e) => {
        const muted = this.audio.toggleMute();
        (e.currentTarget as HTMLButtonElement).textContent = muted ? '🔇' : '🔊';
      });
      this.root.querySelector('[data-reset="1"]')?.addEventListener('click', () => {
        this.engine.restartChamber();
      });
      this.root.querySelector('[data-next="1"]')?.addEventListener('click', () => {
        this.engine.lockAndNextClone();
      });
      this.root.querySelector('[data-coop="1"]')?.addEventListener('click', async () => {
        const res = await this.engine.summonCommunityClone();
        this.showToast(res.message);
      });
      return;
    }

    if (snap.phase === 'failed') {
      this.root.innerHTML = `
        <div class="overlay">
          <div class="card glass fail">
            <div class="eyebrow">TIMELINE FRACTURED</div>
            <h2>LOOP FAILED</h2>
            <p class="subtitle">${this.esc(snap.failReason ?? 'Try locking your clones earlier!')}</p>
            <div class="actions">
              <button type="button" class="btn primary" data-retry="1">Retry Chamber</button>
              ${snap.availableCommunityClones > 0 ? `<button type="button" class="btn coop" data-coop="1">Summon u/Clone</button>` : ''}
            </div>
            <div class="hint">Press Space or R to restart instantly</div>
          </div>
        </div>
      `;
      this.root.querySelector('[data-retry="1"]')?.addEventListener('click', () => {
        this.engine.restartChamber();
      });
      this.root.querySelector('[data-coop="1"]')?.addEventListener('click', async () => {
        const res = await this.engine.summonCommunityClone();
        this.showToast(res.message);
      });
      return;
    }

    if (snap.phase === 'victory') {
      const sec = ((snap.clearTimeMs ?? 0) / 1000).toFixed(2);
      const paradox = snap.paradoxBonus ? `<span class="badge paradox">⚡ PARADOX CLEAR (${snap.clonesUsed}/3)</span>` : '';
      const coop = snap.borrowedCloneOwner
        ? `<span class="badge coop">🤝 Co-op with u/${this.esc(snap.borrowedCloneOwner)}</span>`
        : '';

      this.root.innerHTML = `
        <div class="overlay">
          <div class="card glass victory">
            <div class="eyebrow">${snap.isDailyMode ? `DAILY #${this.esc(snap.seed)} CLEARED` : `ARCHIVE #${this.esc(snap.seed)} CLEARED`}</div>
            <div class="big-time">${sec}<span>s</span></div>
            <div class="badges">
              <span class="badge">${snap.clonesUsed}/3 Clones</span>
              <span class="badge">Shards ${'◆'.repeat(snap.shardsCollected)}${'◇'.repeat(Math.max(0, snap.totalShards - snap.shardsCollected))}</span>
              ${snap.streak > 0 ? `<span class="badge streak">🔥 ${snap.streak}d</span>` : ''}
              ${paradox}${coop}
            </div>
            <pre class="timeline-box">${this.esc(snap.timelineText)}</pre>
            <div data-lb-host="1">${this.renderLeaderboard(snap)}</div>
            <div class="actions">
              <button type="button" class="btn primary" data-share="1">${snap.redditConnected ? 'Post Timeline to Comments' : 'Copy Emoji Timeline'}</button>
              <button type="button" class="btn ghost" data-retry="1">Speedrun Again</button>
            </div>
          </div>
        </div>
      `;

      const shareBtn = this.root.querySelector<HTMLButtonElement>('[data-share="1"]');
      shareBtn?.addEventListener('click', async () => {
        if (snap.redditConnected) {
          shareBtn.disabled = true;
          shareBtn.textContent = 'Posting…';
          const res = await this.engine.shareToReddit();
          shareBtn.disabled = false;
          if (res.ok) {
            shareBtn.textContent = res.alreadyShared ? 'Already Posted ✓' : 'Posted to Comments ✓';
          } else {
            shareBtn.textContent = res.error ?? 'Sign in to Post';
          }
          return;
        }
        const text = [
          `⏱️ CHRONO LOOP #${snap.seed} — ${sec}s (${snap.clonesUsed}/3 Clones)`,
          snap.timelineText,
          `Can you bend time faster?`,
        ].join('\n');
        try {
          await navigator.clipboard.writeText(text);
          shareBtn.textContent = 'Timeline Copied ✓';
        } catch {
          shareBtn.textContent = `${sec}s`;
        }
      });

      this.root.querySelector('[data-retry="1"]')?.addEventListener('click', () => {
        this.engine.restartChamber();
      });
    }
  }

  private renderLeaderboard(snap: GameSnapshot): string {
    if (!snap.leaderboard || snap.leaderboard.length === 0) return '';
    const sub = snap.subredditName ? `r/${this.esc(snap.subredditName)}` : 'Subreddit';
    const rankStr = snap.playerRank ? ` · You #${snap.playerRank}` : '';
    const rows = snap.leaderboard
      .slice(0, 5)
      .map((entry) => {
        const isMe = snap.redditUsername && entry.username === snap.redditUsername;
        const t = entry.timeMs > 0 ? `${(entry.timeMs / 1000).toFixed(2)}s` : `${entry.score}`;
        return `<div class="lb-row${isMe ? ' me' : ''}">
          <span class="lb-rank">#${entry.rank}</span>
          <span class="lb-user">u/${this.esc(entry.username)}</span>
          <span class="lb-meta">${entry.clonesUsed}c · ${t}</span>
        </div>`;
      })
      .join('');
    return `<div class="lb-card">
      <div class="lb-head">${sub} Daily Fastest${rankStr}</div>
      ${rows}
    </div>`;
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
