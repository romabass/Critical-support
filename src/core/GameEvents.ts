/** Глобальные игровые события. Импортируется по типу, не создаёт рантайм-зависимостей. */

import type { DamageKind } from '../data/MaterialProperties';
import type { ObjectiveStatusSnapshot } from '../data/ObjectiveData';
import type { ScoreBreakdown } from '../gameplay/ScoringSystem';

export interface GameEvents {
  'state:changed': { from: string; to: string };
  'level:loaded': { levelId: string };
  'level:restarted': { levelId: string };
  'level:completed': { levelId: string; won: boolean };
  'shot:fired': { index: number; angleDeg: number; power: number; speed: number };
  'shot:expired': { shotsUsed: number; maxShots: number };
  'projectile:impact': { speed: number; x: number; y: number };
  'element:damaged': { elementId: string; damage: number; health: number; kind: DamageKind };
  'element:destroyed': {
    elementId: string;
    group: string | null;
    mass: number;
    x: number;
    y: number;
    kind: DamageKind;
  };
  'connection:broken': { connectionId: string; elementId: string; loadRatio: number };
  'graph:detached': { elementIds: string[] };
  'graph:recomputed': { detachedCount: number; activeConnections: number };
  'generator:damaged': { elementId: string; health: number; damagePercent: number };
  'zone:red_exceeded': { debrisMass: number; limit: number };
  'zone:green_updated': { debrisMass: number; pieces: number };
  'objectives:updated': { snapshot: ObjectiveStatusSnapshot[] };
  'score:updated': { score: number; breakdown: ScoreBreakdown };
  'audio:play': { cue: string; volume?: number };
  'audio:settings': { sfx: number; music: number };
  'settings:changed': Record<string, unknown>;
  'debug:toggle': { overlay: boolean };
  'analysis:toggle': { active: boolean };
  'trajectory:toggle': { visible: boolean };
  notice: { text: string; severity: 'info' | 'warning' | 'danger' };
}

export type GameEventName = keyof GameEvents;
