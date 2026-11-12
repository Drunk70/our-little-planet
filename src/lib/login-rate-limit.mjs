import { createHash } from "node:crypto";
import { isIP } from "node:net";

const WINDOW_MS = 15 * 60_000;
const QUIET_RESET_MS = 24 * 60 * 60_000;
const MAX_FAILURES = 5;
const MAX_IDENTITIES = 10_000;

/** Only trust the header when the deployment proxy overwrites it on every request. */
export function loginIdentity(headers, { trustProxy = false, secret }) {
  const raw = trustProxy ? headers.get("x-real-ip")?.trim() : "";
  let address = "local";
  if (raw && isIP(raw)) {
    if (raw.startsWith("::ffff:") && isIP(raw.slice(7)) === 4) {
      address = raw.slice(7);
    } else if (isIP(raw) === 6) {
      address = new URL(`http://[${raw}]/`).hostname;
    } else {
      address = raw;
    }
  }
  // Persist an opaque key, without storing passwords or the raw IP.
  return createHash("sha256").update(`${secret}:login:${address}`).digest("hex");
}

/** A shared, durable budget for both reader and author password endpoints. */
export function createLoginRateLimit(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      identity TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      window_started INTEGER NOT NULL,
      strikes INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_attempts_updated ON login_attempts(updated_at);
  `);
  const get = database.prepare("SELECT * FROM login_attempts WHERE identity = ?");
  const remove = database.prepare("DELETE FROM login_attempts WHERE identity = ?");
  const purge = database.prepare("DELETE FROM login_attempts WHERE updated_at <= ? AND blocked_until <= ?");
  const count = database.prepare("SELECT COUNT(*) AS n FROM login_attempts");
  const save = database.prepare(`
    INSERT INTO login_attempts VALUES (@identity, @failures, @window_started, @strikes, @blocked_until, @updated_at)
    ON CONFLICT(identity) DO UPDATE SET failures = excluded.failures,
      window_started = excluded.window_started, strikes = excluded.strikes,
      blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
  `);
  let lastCleanup = -Infinity;

  // Password validation and accounting share a synchronous transaction. Concurrent
  // requests cannot all pass an earlier quota check before failures are committed.
  const evaluate = database.transaction((identity, verify, now = Date.now()) => {
    if (now - lastCleanup >= 60_000) {
      purge.run(now - QUIET_RESET_MS, now);
      lastCleanup = now;
    }
    let state = get.get(identity);
    if (state?.blocked_until > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((state.blocked_until - now) / 1000) };
    }
    if (!state && count.get().n >= MAX_IDENTITIES) {
      // Do not evict active locks to make room for an attack with rotating IPs.
      return { allowed: false, retryAfterSeconds: 60 };
    }
    const role = verify();
    if (role) {
      remove.run(identity);
      return { allowed: true, role };
    }
    if (!state || now - state.updated_at >= QUIET_RESET_MS) {
      state = { identity, failures: 0, window_started: now, strikes: 0, blocked_until: 0, updated_at: now };
    } else if (now - state.window_started >= WINDOW_MS) {
      state.failures = 0;
      state.window_started = now;
    }
    state.failures += 1;
    state.updated_at = now;
    if (state.failures >= MAX_FAILURES) {
      const duration = Math.min(WINDOW_MS * 2 ** state.strikes, 60 * 60_000);
      state.blocked_until = now + duration;
      state.strikes = Math.min(state.strikes + 1, 2);
      state.failures = 0;
      state.window_started = now;
    }
    save.run(state);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(0, Math.ceil((state.blocked_until - now) / 1000)),
    };
  });
  return { evaluate };
}
