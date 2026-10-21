// Work that will write to the draft when it finishes, and must not straddle a publish (spec 13.6): an attachment
// being encrypted (the Experience attach flow, for a whole batch) or an access-code change being derived (PBKDF2).
// While any is in flight the Publish button waits (publish-ui.mjs), so a late write can neither be dropped by the
// rebase after the publish nor land wrapped under a vault key that the publish has just rotated away.
// Pure and browser-safe: one shared counter for the dashboard, plus createInflight() for the tests.

/** A counter of in-flight work by kind ('attachments', 'codes'). */
export function createInflight() {
  const counts = new Map();
  const listeners = new Set();
  const notify = () => {
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* a broken listener must not stop the others */ }
    }
  };
  const flight = {
    /** Starts one piece of work; returns its end(), which only counts once. */
    begin(kind = 'attachments') {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      notify();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        flight.end(kind);
      };
    },
    /** Ends one piece of work of `kind` (prefer the function begin() returns). */
    end(kind = 'attachments') {
      const left = (counts.get(kind) ?? 0) - 1;
      if (left > 0) counts.set(kind, left);
      else counts.delete(kind);
      notify();
    },
    /** How many are in flight, of `kind` or of every kind. */
    count(kind) {
      if (kind !== undefined) return counts.get(kind) ?? 0;
      let total = 0;
      for (const n of counts.values()) total += n;
      return total;
    },
    /** The kinds with work in flight, in the order they started. */
    kinds() { return [...counts.keys()]; },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return flight;
}

/** The dashboard's shared counter. */
export const inflight = createInflight();
