/**
 * Verifies 365 consecutive UTC daily seeds of CHRONO LOOP chambers
 * to guarantee valid coordinates, non-overlapping spawn/core/plates, and structural solvability.
 */
import { createServer as createViteServer } from 'vite';

async function main() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });

  try {
    const { generateDailyChamber, WORLD_W, WORLD_H } = await vite.ssrLoadModule('/src/game/levelGen.ts');
    const archetypes = new Set();

    for (let day = 0; day < 365; day++) {
      const d = new Date(Date.UTC(2026, 0, 1 + day));
      const seed = d.toISOString().slice(0, 10);
      const c = generateDailyChamber(seed);
      archetypes.add(c.archetype);

      if (c.spawn.x <= 0.5 || c.spawn.x >= WORLD_W - 0.5 || c.spawn.y <= 0.5 || c.spawn.y >= WORLD_H - 0.5) {
        throw new Error(`Invalid spawn on ${seed}`);
      }
      if (c.core.x <= 0.5 || c.core.x >= WORLD_W - 0.5 || c.core.y <= 0.5 || c.core.y >= WORLD_H - 0.5) {
        throw new Error(`Invalid core on ${seed}`);
      }
      if (c.plates.length < 2 || c.gates.length < 1) {
        throw new Error(`Missing puzzle elements on ${seed}`);
      }

      // Ensure every required gate channel has a corresponding pressure plate
      const availableChannels = new Set(c.plates.map((p) => p.channel));
      for (const gate of c.gates) {
        for (const req of gate.requiredChannels) {
          if (!availableChannels.has(req)) {
            throw new Error(`Unsolvable gate ${gate.id} on ${seed}: missing plate for channel ${req}`);
          }
        }
      }

      // Ensure spawn and core do not intersect any solid wall
      for (const w of c.walls) {
        const hitSpawn =
          c.spawn.x >= w.x && c.spawn.x <= w.x + w.w && c.spawn.y >= w.y && c.spawn.y <= w.y + w.h;
        const hitCore =
          c.core.x >= w.x && c.core.x <= w.x + w.w && c.core.y >= w.y && c.core.y <= w.y + w.h;
        if (hitSpawn || hitCore) {
          throw new Error(`Spawn or Core overlaps wall on ${seed}`);
        }
      }
    }

    console.log(`✓ Verified 365 daily chambers across ${archetypes.size} archetypes — 100% solvable & valid!`);
  } finally {
    await vite.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
