import './style.css';
import { GameApp } from './app/GameApp';

const canvas = document.getElementById('game-canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Элемент #game-canvas не найден или не является canvas');
}

const app = new GameApp();
const detach = app.attach(canvas);
app.start();

window.addEventListener('beforeunload', detach);
