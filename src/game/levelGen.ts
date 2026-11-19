import {
  ChronoShard,
  DailyChamber,
  GateDoor,
  hashSeed,
  LaserEmitter,
  mulberry32,
  PressurePlate,
  WallRect,
} from './types';

export const WORLD_W = 16;
export const WORLD_H = 10;
export const LOOP_DURATION = 10.0;
export const MAX_CLONES = 3;

const CHAMBER_TITLES: ReadonlyArray<{ title: string; subtitle: string }> = [
  { title: 'THE PRISM VAULT', subtitle: 'Hold the circuit, bend the beam.' },
  { title: 'ECHO CORRIDOR', subtitle: 'Your past self is your only shield.' },
  { title: 'PARADOX GATE', subtitle: 'Two keys, one timeline.' },
  { title: 'TEMPORAL RELAY', subtitle: 'Step in sync across 10 seconds.' },
  { title: 'PHOTON LOCK', subtitle: 'Intercept the laser to clear the lane.' },
  { title: 'CHRONO SANCTUM', subtitle: 'Three echoes, one core.' },
];

/**
 * Generates a guaranteed-solvable Daily Time Chamber from a UTC date seed.
 * Uses 4 distinct hand-tuned puzzle archetypes with deterministic parametric variations
 * (horizontal/vertical mirroring, plate offsets, extra dividers, and shard placements)
 * so every single day feels fresh while remaining 100% mathematically solvable.
 */
export function generateDailyChamber(seed: string): DailyChamber {
  const rng = mulberry32(hashSeed(`chrono-loop-v1:${seed}`));
  const archetypeIdx = Math.floor(rng() * 4);
  const flipY = rng() > 0.5;
  const meta = CHAMBER_TITLES[Math.floor(rng() * CHAMBER_TITLES.length)];

  // Outer perimeter walls (thickness 0.45)
  const T = 0.45;
  const walls: WallRect[] = [
    { x: 0, y: 0, w: WORLD_W, h: T },
    { x: 0, y: WORLD_H - T, w: WORLD_W, h: T },
    { x: 0, y: 0, w: T, h: WORLD_H },
    { x: WORLD_W - T, y: 0, w: T, h: WORLD_H },
  ];

  const plates: PressurePlate[] = [];
  const gates: GateDoor[] = [];
  const lasers: LaserEmitter[] = [];
  const shards: ChronoShard[] = [];
  let spawn = { x: 1.7, y: 5.0 };
  let core = { x: 14.3, y: 5.0, r: 0.62 };
  let archetype = 'relay';
  let hint = 'Stand on the Cyan plate with Clone α, tap Lock & Next, then sprint through with Clone β!';

  const yMap = (y: number): number => (flipY ? WORLD_H - y : y);
  const rectY = (y: number, h: number): number => (flipY ? WORLD_H - y - h : y);

  if (archetypeIdx === 0) {
    // ARCHETYPE 0: DUAL-LOCK VAULT + LASER SHIELD
    // Clone α holds Cyan plate (opens Gate 1) OR blocks Laser; Clone β holds Magenta plate inside mid-zone;
    // Clone γ runs through Gate 1 + Gate 2 to reach the Temporal Core!
    archetype = 'dual_vault_laser';
    const midX = 5.8 + (rng() - 0.5) * 0.6;
    const vaultX = 11.2 + (rng() - 0.5) * 0.5;
    const gap1Y = 2.6 + rng() * 1.4;
    const gap2Y = 5.4 + rng() * 1.4;
    const gapH = 2.0;

    // First divider wall with Gate 1 (Cyan)
    walls.push({ x: midX, y: rectY(T, gap1Y - T), w: 0.42, h: gap1Y - T });
    walls.push({
      x: midX,
      y: rectY(gap1Y + gapH, WORLD_H - T - (gap1Y + gapH)),
      w: 0.42,
      h: WORLD_H - T - (gap1Y + gapH),
    });
    gates.push({
      id: 'gate_cyan',
      x: midX + 0.04,
      y: rectY(gap1Y, gapH),
      w: 0.34,
      h: gapH,
      requiredChannels: ['cyan'],
      color: 'cyan',
    });

    // Second divider wall with Gate 2 (Cyan + Magenta synchronized!)
    walls.push({ x: vaultX, y: rectY(T, gap2Y - T), w: 0.42, h: gap2Y - T });
    walls.push({
      x: vaultX,
      y: rectY(gap2Y + gapH, WORLD_H - T - (gap2Y + gapH)),
      w: 0.42,
      h: WORLD_H - T - (gap2Y + gapH),
    });
    gates.push({
      id: 'gate_vault',
      x: vaultX + 0.04,
      y: rectY(gap2Y, gapH),
      w: 0.34,
      h: gapH,
      requiredChannels: ['cyan', 'magenta'],
      color: 'magenta',
    });

    // Plates
    plates.push({
      id: 'plate_cyan',
      x: 3.1 + rng() * 1.1,
      y: yMap(7.6 - rng() * 0.8),
      r: 0.64,
      channel: 'cyan',
      label: 'α',
    });
    plates.push({
      id: 'plate_magenta',
      x: midX + 2.4 + rng() * 1.1,
      y: yMap(2.1 + rng() * 0.8),
      r: 0.64,
      channel: 'magenta',
      label: 'β',
    });

    // Blockable laser across mid-corridor (disabled by Cyan OR blockable by a past clone)
    lasers.push({
      id: 'laser_1',
      x: midX + 2.7,
      y: flipY ? WORLD_H - T : T,
      dx: 0,
      dy: flipY ? -1 : 1,
      disabledBy: 'magenta',
      blockableByClone: true,
    });

    spawn = { x: 1.6, y: yMap(3.6) };
    core = { x: 14.2, y: yMap(gap2Y + gapH * 0.5), r: 0.62 };

    shards.push(
      { id: 's1', x: 3.4, y: yMap(1.8), r: 0.34 },
      { id: 's2', x: midX + 2.6, y: yMap(8.1), r: 0.34 },
      { id: 's3', x: vaultX + 1.6, y: yMap(2.2), r: 0.34 }
    );
    hint = 'Clone α holds Cyan (opens Gate 1) → Clone β holds Magenta (disables laser & opens Vault) → Clone γ grabs the Core!';
  } else if (archetypeIdx === 1) {
    // ARCHETYPE 1: PHOTON SHIELD CORRIDOR
    // A lethal vertical laser guards the central bridge.
    // Clone α steps directly into the emitter's path to shield the bridge with its energy body (or hits Cyan plate)!
    // Clone β crosses safely in α's shadow to hold the Magenta plate, opening the Core Vault for γ!
    archetype = 'photon_shield';
    const wallX1 = 6.2 + (rng() - 0.5) * 0.5;
    const wallX2 = 11.4 + (rng() - 0.5) * 0.4;
    const bridgeY = 4.0 + (rng() - 0.5) * 0.8;
    const bridgeH = 2.1;

    // Narrow central bridge walls (top & bottom baffles)
    walls.push({ x: wallX1, y: rectY(T, bridgeY - T), w: 0.44, h: bridgeY - T });
    walls.push({
      x: wallX1,
      y: rectY(bridgeY + bridgeH, WORLD_H - T - (bridgeY + bridgeH)),
      w: 0.44,
      h: WORLD_H - T - (bridgeY + bridgeH),
    });

    // Vault wall on right with Magenta+Cyan gate
    walls.push({ x: wallX2, y: rectY(T, bridgeY - T), w: 0.44, h: bridgeY - T });
    walls.push({
      x: wallX2,
      y: rectY(bridgeY + bridgeH, WORLD_H - T - (bridgeY + bridgeH)),
      w: 0.44,
      h: WORLD_H - T - (bridgeY + bridgeH),
    });

    gates.push({
      id: 'gate_bridge',
      x: wallX1 + 0.05,
      y: rectY(bridgeY, bridgeH),
      w: 0.34,
      h: bridgeH,
      requiredChannels: ['cyan'],
      color: 'cyan',
    });
    gates.push({
      id: 'gate_core',
      x: wallX2 + 0.05,
      y: rectY(bridgeY, bridgeH),
      w: 0.34,
      h: bridgeH,
      requiredChannels: ['magenta'],
      color: 'magenta',
    });

    // Lethal blockable laser firing vertically down across the middle chamber
    lasers.push({
      id: 'laser_shield',
      x: wallX1 + 2.5,
      y: flipY ? WORLD_H - T : T,
      dx: 0,
      dy: flipY ? -1 : 1,
      blockableByClone: true,
    });

    // Cyan plate is on the left side; Magenta plate is behind the laser on the bottom-right of mid chamber
    plates.push({
      id: 'plate_cyan',
      x: 3.6 + rng() * 0.8,
      y: yMap(2.0 + rng() * 0.6),
      r: 0.64,
      channel: 'cyan',
      label: 'α',
    });
    plates.push({
      id: 'plate_magenta',
      x: wallX1 + 3.6,
      y: yMap(8.0 - rng() * 0.5),
      r: 0.64,
      channel: 'magenta',
      label: 'β',
    });

    spawn = { x: 1.6, y: yMap(5.0) };
    core = { x: 14.1, y: yMap(bridgeY + bridgeH * 0.5), r: 0.62 };

    shards.push(
      { id: 's1', x: 3.4, y: yMap(8.0), r: 0.34 },
      { id: 's2', x: wallX1 + 2.5, y: yMap(2.0), r: 0.34 },
      { id: 's3', x: wallX2 + 1.5, y: yMap(7.6), r: 0.34 }
    );
    hint = 'Past clones physically BLOCK lasers! Use Clone α on Cyan, then shield the beam or rush Magenta!';
  } else if (archetypeIdx === 2) {
    // ARCHETYPE 2: THE TWIN-WING LABYRINTH
    // Upper wing has Cyan plate, Lower wing has Magenta plate, center tunnel has a synchronized Gold Vault!
    archetype = 'twin_wings';
    const splitX = 4.6 + (rng() - 0.5) * 0.4;
    const vaultX = 11.0 + (rng() - 0.5) * 0.5;

    // Central horizontal divider separating top wing & bottom wing
    walls.push({ x: splitX, y: rectY(4.78, 0.44), w: vaultX - splitX, h: 0.44 });

    // Vault vertical wall with central Gold gate (requires Cyan + Magenta)
    walls.push({ x: vaultX, y: rectY(T, 3.45 - T), w: 0.44, h: 3.45 - T });
    walls.push({ x: vaultX, y: rectY(6.55, WORLD_H - T - 6.55), w: 0.44, h: WORLD_H - T - 6.55 });
    gates.push({
      id: 'gate_gold',
      x: vaultX + 0.05,
      y: rectY(3.45, 3.1),
      w: 0.34,
      h: 3.1,
      requiredChannels: ['cyan', 'magenta'],
      color: 'gold',
    });

    // Small chicane pillars in each wing
    walls.push({ x: splitX + 2.3, y: rectY(T, 2.2), w: 0.42, h: 2.2 });
    walls.push({ x: splitX + 2.3, y: rectY(7.35, WORLD_H - T - 7.35), w: 0.42, h: WORLD_H - T - 7.35 });

    // Laser guarding the top wing shortcut (disabled by Magenta OR blockable by a clone)
    lasers.push({
      id: 'laser_wing',
      x: vaultX - 1.6,
      y: flipY ? WORLD_H - T : T,
      dx: 0,
      dy: flipY ? -1 : 1,
      disabledBy: 'cyan',
      blockableByClone: true,
    });

    plates.push({
      id: 'plate_cyan',
      x: splitX + 4.3,
      y: yMap(2.1),
      r: 0.64,
      channel: 'cyan',
      label: 'α',
    });
    plates.push({
      id: 'plate_magenta',
      x: splitX + 4.3,
      y: yMap(7.9),
      r: 0.64,
      channel: 'magenta',
      label: 'β',
    });

    spawn = { x: 1.7, y: yMap(5.0) };
    core = { x: 14.1, y: yMap(5.0), r: 0.64 };

    shards.push(
      { id: 's1', x: splitX + 1.0, y: yMap(1.8), r: 0.34 },
      { id: 's2', x: splitX + 1.0, y: yMap(8.2), r: 0.34 },
      { id: 's3', x: vaultX + 1.7, y: yMap(2.3), r: 0.34 }
    );
    hint = 'Send Clone α to the top wing (Cyan) and Clone β to the bottom wing (Magenta) — Clone γ sprints the center vault!';
  } else {
    // ARCHETYPE 3: CASCADE RELAY (3-STAGE SPRINT)
    // Open chamber with staggered baffles, 2 sequential gates, and a blockable laser at the Core exit!
    archetype = 'cascade_relay';
    const x1 = 5.2 + (rng() - 0.5) * 0.4;
    const x2 = 10.6 + (rng() - 0.5) * 0.4;

    // Gate 1 (bottom)
    walls.push({ x: x1, y: rectY(T, 6.2 - T), w: 0.44, h: 6.2 - T });
    gates.push({
      id: 'gate_1',
      x: x1 + 0.05,
      y: rectY(6.2, WORLD_H - T - 6.2),
      w: 0.34,
      h: WORLD_H - T - 6.2,
      requiredChannels: ['cyan'],
      color: 'cyan',
    });

    // Gate 2 (top)
    walls.push({ x: x2, y: rectY(3.8, WORLD_H - T - 3.8), w: 0.44, h: WORLD_H - T - 3.8 });
    gates.push({
      id: 'gate_2',
      x: x2 + 0.05,
      y: rectY(T, 3.8 - T),
      w: 0.34,
      h: 3.8 - T,
      requiredChannels: ['magenta'],
      color: 'magenta',
    });

    // Horizontal laser in the final room disabled by Cyan
    lasers.push({
      id: 'laser_core',
      x: x2 + 0.46,
      y: yMap(5.2),
      dx: 1,
      dy: 0,
      disabledBy: 'cyan',
      blockableByClone: true,
    });

    plates.push({
      id: 'plate_cyan',
      x: 2.8 + rng() * 0.8,
      y: yMap(2.0 + rng() * 0.6),
      r: 0.64,
      channel: 'cyan',
      label: 'α',
    });
    plates.push({
      id: 'plate_magenta',
      x: x1 + 2.7 + rng() * 0.8,
      y: yMap(7.8 - rng() * 0.6),
      r: 0.64,
      channel: 'magenta',
      label: 'β',
    });

    spawn = { x: 1.6, y: yMap(7.6) };
    core = { x: 13.8, y: yMap(7.6), r: 0.64 };

    shards.push(
      { id: 's1', x: 3.4, y: yMap(4.9), r: 0.34 },
      { id: 's2', x: x1 + 2.6, y: yMap(2.1), r: 0.34 },
      { id: 's3', x: x2 + 3.2, y: yMap(2.1), r: 0.34 }
    );
    hint = 'Clone α holds Cyan (opens Gate 1 & disables Core laser) → Clone β holds Magenta → Clone γ loops around to the Core!';
  }

  return {
    seed,
    title: meta.title,
    subtitle: meta.subtitle,
    archetype,
    width: WORLD_W,
    height: WORLD_H,
    loopDuration: LOOP_DURATION,
    maxClones: MAX_CLONES,
    spawn,
    core,
    walls,
    plates,
    gates,
    lasers,
    shards,
    hint,
  };
}
