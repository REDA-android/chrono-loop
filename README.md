# CHRONO LOOP — Daily Time-Clone Puzzle for Reddit

**CHRONO LOOP** is an original, ultra-lightweight (< 35 KB client bundle) 1-thumb daily puzzle-action game built natively for **Reddit's Game of the Day Hackathon 2026** on **Devvit Web** and **Redis**.

Cooperate with your own past ghosts across **three 10-second time loops** to unlock gates, physically block photon lasers with your past self's energy shield, collect Chrono-Shards, and reach the **Temporal Core** — or summon another Redditor's real recorded clone from Redis for **Asynchronous Co-op**!

---

## How to Play

Every UTC day generates a shared deterministic **Time Chamber** (`Daily #YYYY-MM-DD`) for the entire subreddit:

1. **Loop 1 — Clone α (Cyan):** Move onto the Cyan pressure plate to unlock a gate, or stand in front of a photon laser emitter. Tap **Lock α → Next** (or press `Space`) to lock your path early and rewind!
2. **Loop 2 — Clone β (Magenta):** Your **Clone α replays your exact movements live** and holds its final position as a Chrono Anchor. Walk through the gate Clone α opened — or step safely through the shadow of a laser Clone α is physically blocking — and hold the Magenta plate.
3. **Loop 3 — Clone γ (Gold):** Both **Clone α and Clone β replay together**. Sprint through the unlocked vault and touch the **Golden Temporal Core** before time runs out!

### Controls

| Action | Mobile / Touch | Desktop |
| --- | --- | --- |
| **Move Clone** | Drag anywhere (1-thumb virtual joystick) | `WASD` or Arrow Keys |
| **Lock Clone & Rewind** | Tap **Lock → Next** | `Space` |
| **Reset Chamber** | Tap **Reset** | `R` |
| **Async Co-op** | Tap **Summon u/Clone** | Click **Summon u/Clone** |

---

## Reddit & Community Features

- **Async Co-op ("Summon u/Clone"):** Whenever a Redditor clears today's chamber, their Clone α trajectory is stored in a subreddit Redis pool. Other players can summon a real Redditor's recorded Clone α (`u/username`) into their own chamber to cooperate asynchronously!
- **Spoiler-Free Emoji Timeline Comments:** One tap posts your exact temporal timeline directly as a comment on the Reddit post via `@devvit/web/server` (with anti-spam protection and zero external links):
  ```text
  ⏱️ CHRONO LOOP #2026-11-19 — Cleared in 11.42s (2/3 Clones ⚡ PARADOX CLEAR)
  🔵 [━━🔘━━━━━]
  🟣 [━━━━🛡️🎯]
  ```
- **Subreddit Daily Leaderboard & Streaks (Redis):** Tracks fastest clear times, fewest clones used (*Paradox Bonus* for ≤ 2 clones), Chrono-Shards, and multi-day streaks in Redis across app versions (with guest support for logged-out Redditors).
- **Strict CSP & Instant Mobile Load:** Pure Canvas 2D neon rendering, procedural WebAudio synthesizer, native system typography — **zero external network requests**, **zero heavy assets**, 60 FPS on any phone.

---

## Development & Deployment (Devvit Web)

```bash
# 1. Install dependencies
npm install

# 2. Verify 365 consecutive daily chambers for solvability
npm run verify:levels

# 3. Build client (dist/client) and Devvit CJS server (dist/server/index.cjs)
npm run build

# 4. Playtest live on your public test subreddit (< 200 members)
npx devvit login
npx devvit playtest <your-test-subreddit>

# 5. Upload to Reddit Developers
npx devvit upload
```

Once installed on a subreddit, `onAppInstall` automatically publishes the first **CHRONO LOOP Daily Post**. Moderators can also create new daily posts anytime from the subreddit menu (**"Create Chrono Loop Daily Post"**).

---

## License & Credits

100% original code, procedural audio, and geometric neon visuals created for **Reddit's Game of the Day Hackathon 2026**. Built with `@devvit/web`, `vite`, and `typescript`.
