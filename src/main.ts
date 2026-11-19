import './styles/main.css';
import { ChronoAudio } from './game/audio';
import { ChronoEngine } from './game/ChronoEngine';
import { HudController } from './ui/HudController';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud');

if (!canvas || !hudRoot) {
  throw new Error('Required #stage canvas or #hud container not found.');
}

const audio = new ChronoAudio();
let hud: HudController;

const engine = new ChronoEngine(canvas, audio, (snapshot) => {
  hud?.update(snapshot);
});

hud = new HudController(hudRoot, engine, audio);
engine.startLoop();
