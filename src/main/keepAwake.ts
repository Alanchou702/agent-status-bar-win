import { powerSaveBlocker } from 'electron';

let blocker: number | null = null;
export function isKeepAwakeActive(): boolean {
  return blocker !== null && powerSaveBlocker.isStarted(blocker);
}
export function setKeepAwake(on: boolean): void {
  if (on && !isKeepAwakeActive()) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && blocker !== null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
}

