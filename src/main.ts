import './styles.css';
import { Game } from './game/Game';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Application root #app was not found.');
}

new Game(root);
