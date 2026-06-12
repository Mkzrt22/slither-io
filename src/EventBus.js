/**
 * EventBus.ts — UI-Decoupled Pub/Sub Architecture (Lucky Dungeon Tycoon)
 *
 * Lightweight, fully type-safe event messenger between the model layer and
 * the View. Subscribers never import engines; engines never import views —
 * both sides only know this bus and the domain types.
 */
export class EventBus {
    constructor() {
        /**
         * Per-event subscriber sets. Sets give O(1) off() and free duplicate
         * suppression. Values are stored as the widest callback shape and narrowed
         * at the type-safe public boundary.
         */
        this.listeners = new Map();
    }
    /**
     * Subscribes `callback` to `event`. Subscribing the same function twice is
     * a no-op. Returns an unsubscribe thunk so call-sites can tear down without
     * retaining a reference to the callback themselves.
     */
    on(event, callback) {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(callback);
        return () => this.off(event, callback);
    }
    /** Unsubscribes `callback` from `event`; unknown pairs are ignored. */
    off(event, callback) {
        const set = this.listeners.get(event);
        if (!set) {
            return;
        }
        set.delete(callback);
        if (set.size === 0) {
            this.listeners.delete(event);
        }
    }
    /**
     * Subscribes for exactly one delivery, then auto-unsubscribes. Returns an
     * unsubscribe thunk in case the event never fires.
     */
    once(event, callback) {
        const wrapper = (payload) => {
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
    emit(event, payload) {
        const set = this.listeners.get(event);
        if (!set || set.size === 0) {
            return;
        }
        for (const callback of Array.from(set)) {
            try {
                callback(payload);
            }
            catch (error) {
                console.error(`[EventBus] subscriber for "${event}" threw:`, error);
            }
        }
    }
    /** Number of active subscribers for an event (diagnostics / tests). */
    listenerCount(event) {
        return this.listeners.get(event)?.size ?? 0;
    }
    /** Drops every subscriber for every event (scene teardown / tests). */
    removeAllListeners() {
        this.listeners.clear();
    }
}
/**
 * Shared default bus instance. Modules that want isolation (tests, multiple
 * game instances on one page) can construct their own EventBus instead.
 */
export const gameEvents = new EventBus();
