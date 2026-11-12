import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createLoginRateLimit, loginIdentity } from "../src/lib/login-rate-limit.mjs";

const start = 1_800_000_000_000;
const quarterHour = 15 * 60_000;
const wrong = () => null;

test("第五次失败立即锁定；封锁期间正确密码也不校验、不延长锁定；其他 IP 不受影响", () => {
  const database = new Database(":memory:");
  try {
    const guard = createLoginRateLimit(database);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(guard.evaluate("one", wrong, start), { allowed: false, retryAfterSeconds: 0 });
    }
    assert.deepEqual(guard.evaluate("one", wrong, start), { allowed: false, retryAfterSeconds: 900 });
    assert.deepEqual(guard.evaluate("one", () => { throw new Error("must not validate while locked"); }, start + 1000),
      { allowed: false, retryAfterSeconds: 899 });
    assert.deepEqual(guard.evaluate("two", () => "reader", start), { allowed: true, role: "reader" });
    assert.deepEqual(guard.evaluate("one", () => "author", start + quarterHour), { allowed: true, role: "author" });
  } finally { database.close(); }
});

test("重建数据库连接后仍封锁；两个登录入口共用一个 IP 计数", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "planet-login-test-"));
  const filename = path.join(directory, "attempts.db");
  let database;
  try {
    database = new Database(filename);
    const guard = createLoginRateLimit(database);
    for (let i = 0; i < 3; i++) guard.evaluate("shared", wrong, start); // reader endpoint
    for (let i = 0; i < 2; i++) guard.evaluate("shared", wrong, start); // author endpoint
    database.close();
    database = new Database(filename);
    const restarted = createLoginRateLimit(database);
    assert.deepEqual(restarted.evaluate("shared", wrong, start + 1000),
      { allowed: false, retryAfterSeconds: 899 });
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM login_attempts").get().n, 1);
  } finally {
    database?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("planet-login-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("反复失败延长 15/30/60 分钟并封顶；成功登录和 24 小时无失败分别清除历史", () => {
  const database = new Database(":memory:");
  try {
    const guard = createLoginRateLimit(database);
    let now = start;
    for (const seconds of [900, 1800, 3600, 3600]) {
      for (let i = 0; i < 4; i++) assert.equal(guard.evaluate("one", wrong, now).retryAfterSeconds, 0);
      assert.equal(guard.evaluate("one", wrong, now).retryAfterSeconds, seconds);
      now += seconds * 1000;
    }
    assert.equal(guard.evaluate("one", () => "reader", now).allowed, true);
    for (let i = 0; i < 5; i++) guard.evaluate("one", wrong, now);
    assert.equal(guard.evaluate("one", wrong, now).retryAfterSeconds, 900);
    now += 24 * 60 * 60_000;
    for (let i = 0; i < 4; i++) guard.evaluate("one", wrong, now);
    assert.equal(guard.evaluate("one", wrong, now).retryAfterSeconds, 900);
  } finally { database.close(); }
});

test("过期失败窗口不会累计；校验异常回滚事务，损坏数据库不放行", () => {
  const database = new Database(":memory:");
  try {
    const guard = createLoginRateLimit(database);
    for (let i = 0; i < 4; i++) guard.evaluate("one", wrong, start);
    assert.equal(guard.evaluate("one", wrong, start + quarterHour).retryAfterSeconds, 0);
    assert.throws(() => guard.evaluate("one", () => { throw new Error("validation failed"); }, start + quarterHour));
    assert.equal(database.prepare("SELECT failures FROM login_attempts WHERE identity='one'").get().failures, 1);
    database.exec("DROP TABLE login_attempts");
    assert.throws(() => guard.evaluate("one", () => "author", start + quarterHour));
  } finally { database.close(); }
});

test("仅信任明确配置的 X-Real-IP，忽略伪造转发链，并规范化 IPv6", () => {
  const identity = (real, forwarded, trustProxy = true) => loginIdentity(new Headers({
    "X-Real-IP": real, "X-Forwarded-For": forwarded,
  }), { trustProxy, secret: "test-key" });
  assert.equal(identity("203.0.113.1", "fake-one"), identity("203.0.113.1", "fake-two"));
  assert.notEqual(identity("203.0.113.1", ""), identity("203.0.113.2", ""));
  assert.equal(identity("203.0.113.1", "", false), identity("203.0.113.2", "", false));
  assert.equal(identity("invalid", ""), identity("", ""));
  assert.equal(identity("2001:db8::1", ""), identity("2001:0db8:0:0:0:0:0:1", ""));
  assert.equal(identity("::ffff:203.0.113.1", ""), identity("203.0.113.1", ""));
  assert.match(identity("203.0.113.1", ""), /^[a-f0-9]{64}$/);
});

test("大量新 IP 不驱逐既有锁定；陈旧记录清理后可以继续登录", () => {
  const database = new Database(":memory:");
  try {
    const guard = createLoginRateLimit(database);
    const insert = database.prepare("INSERT INTO login_attempts VALUES (?, 0, ?, 1, ?, ?)");
    database.transaction(() => {
      for (let i = 0; i < 10000; i++) insert.run(String(i), start, start + quarterHour, start);
    })();
    assert.deepEqual(guard.evaluate("new", () => "author", start), { allowed: false, retryAfterSeconds: 60 });
    assert.equal(guard.evaluate("0", wrong, start).retryAfterSeconds, 900);
    assert.equal(guard.evaluate("new", () => "author", start + 24 * 60 * 60_000).allowed, true);
  } finally { database.close(); }
});
