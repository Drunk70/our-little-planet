import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { authSecret, checkPassword } from "./auth";
import { IS_DEMO } from "./demo";
import { createLoginRateLimit, loginIdentity, type LoginRole } from "./login-rate-limit.mjs";

declare global {
  var __planetLoginGuard: ReturnType<typeof createLoginRateLimit> | undefined;
}

function getGuard() {
  if (!globalThis.__planetLoginGuard) {
    const directory = path.join(process.cwd(), "data");
    mkdirSync(directory, { recursive: true });
    const database = new Database(IS_DEMO ? ":memory:" : path.join(directory, "login-attempts.db"));
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
    database.pragma("busy_timeout = 8000");
    globalThis.__planetLoginGuard = createLoginRateLimit(database);
  }
  return globalThis.__planetLoginGuard;
}

/** Keep every password entrance on the same IP budget. */
function guardedAttempt(
  request: Request,
  verify: () => LoginRole | null,
  invalidMessage: string,
): LoginRole | NextResponse {
  try {
    const identity = loginIdentity(request.headers, {
      trustProxy: process.env.LOGIN_TRUST_PROXY === "1",
      secret: authSecret(),
    });
    const verdict = getGuard().evaluate(identity, verify);
    if (verdict.allowed) return verdict.role;
    if (verdict.retryAfterSeconds > 0) {
      const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
      return NextResponse.json(
        { error: `尝试次数过多，请在约 ${minutes} 分钟后再试。`, retryAfterSeconds: verdict.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds), "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: invalidMessage },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // A broken or unwritable ledger must not silently disable login protection.
    console.error("登录保护状态不可用，请检查服务器日志和磁盘。");
    return NextResponse.json(
      { error: "登录暂时不可用，请稍后再试。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export function guardedLogin(
  request: Request,
  password: unknown,
  authorOnly = false,
): LoginRole | NextResponse {
  return guardedAttempt(request, () => {
    if (checkPassword("author", password)) return "author";
    if (!authorOnly && checkPassword("reader", password)) return "reader";
    return null;
  }, authorOnly ? "这不是作者的口令哦" : "密码好像不对哦，再想想？");
}

/** A successful egg password check only authorizes its own unlock route. */
export function guardedUnlock(
  request: Request,
  password: unknown,
  expected: string,
): NextResponse | null {
  const verdict = guardedAttempt(request, () => {
    if (typeof password !== "string" || password.length === 0) return null;
    return password === expected ? "reader" : null;
  }, "这串密码不对哦，再想想？");
  return verdict instanceof NextResponse ? verdict : null;
}
