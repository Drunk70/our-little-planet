import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import * as tar from "tar";
import { createBackup, restoreBackup, verifyBackup } from "./lib/backup.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "planet-backup-test-"));
  const dataDir = path.join(directory, "source", "data");
  await mkdir(path.join(dataDir, "media"), { recursive: true });
  const database = new Database(path.join(dataDir, "journal.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("wal_autocheckpoint = 0");
  database.exec(`
    CREATE TABLE entries (id TEXT PRIMARY KEY, body TEXT, ref_media TEXT);
    CREATE TABLE media (id TEXT PRIMARY KEY, filename TEXT, live_video_id TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE milestones (id TEXT);
    CREATE TABLE eggs (id TEXT);
    CREATE TABLE egg_doodles (id TEXT);
    CREATE TABLE marks (id TEXT);
    CREATE TABLE screenings (id TEXT);
    INSERT INTO entries VALUES ('memory', '雨天的记忆 ♥', '["photo","video"]');
    INSERT INTO media VALUES ('photo', 'photo.jpg', 'video'), ('video', 'video.mov', NULL);
    INSERT INTO settings VALUES ('title', '我们的手账');
  `);
  await writeFile(path.join(dataDir, "media", "photo.jpg"), Buffer.from([0, 255, 25, 128]));
  await writeFile(path.join(dataDir, "media", "video.mov"), Buffer.alloc(1024 * 1024, 42));
  await writeFile(path.join(dataDir, "media", "photo_thumb.webp"), "thumbnail");
  await writeFile(path.join(dataDir, "local-dev.stdout.log"), "excluded log");
  t.after(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, dataDir, database, storage: "local", appVersion: "test" };
}

test("WAL 中的记录、设置、实况配对与媒体完整恢复，日志不入包，源数据保留", async (t) => {
  const source = await fixture(t);
  const backup = await createBackup(source);
  t.after(backup.cleanup);
  const manifest = await verifyBackup(backup.archivePath);
  assert.equal(manifest.counts.entries, 1);
  assert.equal(manifest.counts.media, 2);
  assert.equal(manifest.files.length, 4);
  const target = path.join(source.directory, "new-server", "data");
  await restoreBackup(backup.archivePath, target);
  const restored = new Database(path.join(target, "journal.db"), { readonly: true });
  try {
    assert.equal(restored.prepare("SELECT body FROM entries").get().body, "雨天的记忆 ♥");
    assert.equal(restored.prepare("SELECT value FROM settings").get().value, "我们的手账");
    assert.equal(restored.prepare("SELECT live_video_id FROM media WHERE id = 'photo'").get().live_video_id, "video");
    assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  } finally { restored.close(); }
  for (const filename of ["photo.jpg", "video.mov", "photo_thumb.webp"]) {
    assert.deepEqual(await readFile(path.join(target, "media", filename)), await readFile(path.join(source.dataDir, "media", filename)));
  }
  assert.deepEqual((await readdir(target)).sort(), ["journal.db", "media"]);
  assert.equal(source.database.prepare("SELECT COUNT(*) AS n FROM entries").get().n, 1);
  await assert.rejects(restoreBackup(backup.archivePath, target), /已有内容/);
});

test("缺失原媒体、OSS、取消操作均报错，不会生成伪完整备份", async (t) => {
  const source = await fixture(t);
  await assert.rejects(createBackup({ ...source, storage: "oss" }), /OSS/);
  await assert.rejects(createBackup({ ...source, signal: AbortSignal.abort() }), /abort/i);
  await rm(path.join(source.dataDir, "media", "photo.jpg"));
  await assert.rejects(createBackup(source), /缺少媒体文件/);
});

test("篡改、截断的备份不能恢复，目标目录不留下半份数据", async (t) => {
  const source = await fixture(t);
  const backup = await createBackup(source);
  t.after(backup.cleanup);
  const unpacked = path.join(source.directory, "unpacked");
  await mkdir(unpacked);
  await tar.x({ file: backup.archivePath, cwd: unpacked });
  await writeFile(path.join(unpacked, "media", "photo.jpg"), "damaged");
  const corrupt = path.join(source.directory, "corrupt.tar.gz");
  await tar.c({ file: corrupt, cwd: unpacked, gzip: true }, ["manifest.json", "RESTORE.txt", ...backup.manifest.files.map((f) => f.path)]);
  const target = path.join(source.directory, "restore-data");
  await assert.rejects(restoreBackup(corrupt, target), /校验失败/);
  await assert.rejects(readdir(target), { code: "ENOENT" });
  const bytes = await readFile(backup.archivePath);
  const truncated = path.join(source.directory, "truncated.tar.gz");
  await writeFile(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)));
  await assert.rejects(verifyBackup(truncated));
});

test("不支持的格式、重复条目、路径穿越不能通过验证", async (t) => {
  const source = await fixture(t);
  const backup = await createBackup(source);
  t.after(backup.cleanup);
  const unpacked = path.join(source.directory, "unpacked");
  await mkdir(unpacked);
  await tar.x({ file: backup.archivePath, cwd: unpacked });
  const members = ["manifest.json", "RESTORE.txt", ...backup.manifest.files.map((f) => f.path)];
  const duplicate = path.join(source.directory, "duplicate.tar.gz");
  await tar.c({ file: duplicate, cwd: unpacked, gzip: true }, [...members, "journal.db"]);
  await assert.rejects(verifyBackup(duplicate), /重复文件/);
  const traversal = path.join(source.directory, "traversal.tar.gz");
  await writeFile(path.join(source.directory, "outside.txt"), "outside");
  await tar.c({ file: traversal, cwd: unpacked, gzip: true, preservePaths: true }, ["../outside.txt", ...members]);
  await assert.rejects(verifyBackup(traversal), /路径/);
  await writeFile(path.join(unpacked, "manifest.json"), JSON.stringify({ ...backup.manifest, version: 999 }));
  const unknown = path.join(source.directory, "unknown.tar.gz");
  await tar.c({ file: unknown, cwd: unpacked, gzip: true }, members);
  await assert.rejects(verifyBackup(unknown), /版本/);
});

test("命令行可从旧站备份、验证并恢复到新站，重复执行拒绝覆盖", async (t) => {
  const source = await fixture(t);
  const cli = fileURLToPath(new URL("./backup.mjs", import.meta.url));
  const archive = path.join(source.directory, "我的备份 package.tar.gz");
  const run = (action, cwd) => promisify(execFile)(process.execPath, [cli, action, archive], {
    cwd, windowsHide: true, env: { ...process.env, OSS_BUCKET: "", NEXT_PUBLIC_DEMO_MODE: "" },
  });
  const oldSite = path.dirname(source.dataDir);
  assert.match((await run("create", oldSite)).stdout, /备份已保存/);
  await assert.rejects(run("create", oldSite));
  assert.match((await run("verify", oldSite)).stdout, /完整性校验通过/);
  const newSite = path.join(source.directory, "新服务器");
  await mkdir(newSite);
  assert.match((await run("restore", newSite)).stdout, /恢复完成/);
  await assert.rejects(run("restore", newSite));
  assert.deepEqual(await readFile(path.join(newSite, "data", "media", "photo.jpg")), await readFile(path.join(source.dataDir, "media", "photo.jpg")));
});
