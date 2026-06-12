/**
 * EventBus.ts — UI-Decoupled Pub/Sub Architecture (Lucky Dungeon Tycoon)
 *
 * Lightweight, fully type-safe event messenger between the model layer and
 * the View. Subscribers never import engines; engines never import views —
 * both sides only know this bus and the domain types.
 */

import { SpinResult, UserProfile } from './types.js';

/** Severity levels surfaced by toast/banner notifications. */
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * The complete event vocabulary, mapping each event name to its payload type.
 * Adding an event here automatically types on/off/emit for it everywhere.
 */
export interface GameEventMap {
  /** The authoritative profile changed; views should re-render. */
  'state:updated': UserProfile;
  /** A spin resolved; the slot UI should animate this outcome. */
  'spin:result': SpinResult;
  /** The player ran out of energy; show the refill/ad popup. */
  'ui:popup_energy': { energy: number; maxEnergy: number };
  /** Generic toast/banner message. */
  'ui:notification': { message: string; severity: NotificationSeverity };
}

export type GameEventName = keyof GameEventMap;

/** A typed subscriber callback for a specific event. */
export type EventCallback<E extends GameEventName> = (
  payload: GameEventMap[E],
) => void;

export class EventBus {
  /**
   * Per-event subscriber sets. Sets give O(1) off() and free duplicate
   * suppression. Values are stored as the widest callback shape and narrowed
   * at the type-safe public boundary.
   */
  private readonly listeners = new Map<
    GameEventName,
    Set<(payload: unknown) => void>
  >();

  /**
   * Subscribes `callback` to `event`. Subscribing the same function twice is
   * a no-op. Returns an unsubscribe thunk so call-sites can tear down without
   * retaining a reference to the callback themselves.
   */
  public on<E extends GameEventName>(
    event: E,
    callback: EventCallback<E>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback as (payload: unknown) => void);
    return () => this.off(event, callback);
  }

  /** Unsubscribes `callback` from `event`; unknown pairs are ignored. */
  public off<E extends GameEventName>(
    event: E,
    callback: EventCallback<E>,
  ): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    set.delete(callback as (payload: unknown) => void);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Subscribes for exactly one delivery, then auto-unsubscribes. Returns an
   * unsubscribe thunk in case the event never fires.
   */
  public once<E extends GameEventName>(
    event: E,
    callback: EventCallback<E>,
  ): () => void {
    const wrapper: EventCallback<E> = (payload) => {
      this.off(event, wrapper);
      callback(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Emits `event` to all current subscribers. The subscriber set is copied
   * before iteration so callbacks may safely subscribe/unsubscribe during
   * delivery. A throwing subscriber is isolated: its error is reported via
   * console.error and the remaining subscribers still run, because one broken
   * view component must never sever the model->UI pipeline for the others.
   */
  public emit<E extends GameEventName>(
    event: E,
    payload: GameEventMap[E],
  ): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return;
    }
    for (const callback of Array.from(set)) {
      try {
        callback(payload);
      } catch (error) {
        console.error(`[EventBus] subscriber for "${event}" threw:`, error);
      }
    }
  }

  /** Number of active subscribers for an event (diagnostics / tests). */
  public listenerCount(event: GameEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Drops every subscriber for every event (scene teardown / tests). */
  public removeAllListeners(): void {
    this.listeners.clear();
  }
}

/**
 * Shared default bus instance. Modules that want isolation (tests, multiple
 * game instances on one page) can construct their own EventBus instead.
 */
export const gameEvents = new EventBus();
