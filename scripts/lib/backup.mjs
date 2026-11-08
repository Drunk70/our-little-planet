import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as tar from "tar";

const FORMAT = "our-little-planet-backup";
const VERSION = 1;
const RESTORE_HELP = `我们的小星球 · 完整数据备份

新服务器安装同一版本或兼容的新版本项目后，在项目目录执行：
  npm run backup:verify -- /path/to/backup.tar.gz
  npm run restore -- /path/to/backup.tar.gz

恢复前不要启动网站或初始化示例数据。恢复命令只接受不存在或空的 data 目录，
不会覆盖已有记录。恢复成功后，重新配置 .env.local，再启动网站。

包含：数据库（全部记录、设置、关联）、本地媒体、SHA-256 校验清单。
不包含：程序代码、.env.local、服务器配置。请另外保存代码版本及运行配置。
此备份针对本地存储；不包含阿里云 OSS 上的文件。
备份包含私密记录，请妥善保存。迁移后确认文字、照片、视频和语音可用，
再停用旧服务器。完整操作说明见项目 docs/backup-and-migration.md。
`;

function safePath(name) {
  return typeof name === "string" && name.length > 0 && !/[\\:\x00-\x1f]/.test(name)
    && !name.startsWith("/") && name.split("/").every((part) => part && part !== "." && part !== "..");
}

function payloadPath(name) {
  return name === "journal.db" || (safePath(name) && name.startsWith("media/"));
}

async function checksum(filename, signal) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filename, { signal })) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function filesUnder(dir, prefix = "") {
  const result = [];
  if (!(await lstat(dir)).isDirectory()) throw new Error("媒体目录必须是普通目录，不能是链接");
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (!safePath(relative)) throw new Error("媒体文件名不适合跨服务器迁移");
    if (item.isDirectory()) result.push(...await filesUnder(path.join(dir, item.name), relative));
    else if (item.isFile()) result.push(relative);
    else throw new Error("媒体目录中包含链接或特殊文件，无法生成完整备份");
  }
  return result.sort();
}

function inspectDatabase(filename, files) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("数据库完整性检查未通过");
    const required = ["settings", "entries", "media", "milestones", "eggs", "egg_doodles", "marks", "screenings"];
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    if (required.some((name) => !tables.has(name))) throw new Error("备份数据库缺少必要的数据表");
    const media = db.prepare("SELECT filename FROM media").all();
    for (const row of media) {
      // OSS 迁移后的对象 key 带 media/ 前缀，不能把留下的旧文件误认为完整数据。
      if (!safePath(row.filename) || row.filename.includes("/")) {
        throw new Error("当前备份只支持本地媒体；检测到远程或不支持的媒体路径");
      }
      if (!files.has(`media/${row.filename}`)) throw new Error(`缺少媒体文件：${row.filename}，备份不完整`);
    }
    return { entries: db.prepare("SELECT COUNT(*) AS n FROM entries").get().n, media: media.length };
  } finally {
    db.close();
  }
}

/** 使用 SQLite backup API 捕获 WAL 中的最新记录，逐文件复制/校验，避免大视频占满内存。
 * 调用方在下载结束后必须执行 cleanup()。源数据永不改写。
 */
export async function createBackup({ database, dataDir, storage = "local", appVersion = "unknown", signal }) {
  if (storage !== "local") throw new Error("当前备份仅支持本地存储；使用 OSS 时需另行备份云端媒体");
  if (database.name === ":memory:") throw new Error("演示模式不提供持久数据备份");
  const directory = await mkdtemp(path.join(os.tmpdir(), "planet-backup-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const payload = path.join(directory, "payload");
    await mkdir(path.join(payload, "media"), { recursive: true });
    signal?.throwIfAborted();
    await database.backup(path.join(payload, "journal.db"));
    // 备份独立于源库的 WAL；改为 DELETE 模式后，恢复只需一个数据库文件。
    const snapshot = new Database(path.join(payload, "journal.db"));
    try { snapshot.pragma("journal_mode = DELETE"); } finally { snapshot.close(); }
    const mediaDir = path.join(dataDir, "media");
    const mediaFiles = await filesUnder(mediaDir);
    const names = ["journal.db", ...mediaFiles.map((name) => `media/${name}`)];
    const counts = inspectDatabase(path.join(payload, "journal.db"), new Set(names));
    const files = [];
    for (const name of names) {
      signal?.throwIfAborted();
      const destination = path.join(payload, name);
      if (name !== "journal.db") {
        const source = path.join(dataDir, name);
        const before = await lstat(source);
        if (!before.isFile()) throw new Error("媒体文件已变化，请暂停编辑后重试备份");
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
        const after = await lstat(source);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
          throw new Error("备份期间媒体被修改，请暂停编辑后重试");
        }
      }
      files.push({ path: name, ...await checksum(destination, signal) });
    }
    const manifest = { format: FORMAT, version: VERSION, appVersion, createdAt: new Date().toISOString(), storage: "local", counts, files };
    await writeFile(path.join(payload, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(path.join(payload, "RESTORE.txt"), RESTORE_HELP);
    const archivePath = path.join(directory, "backup.tar.gz");
    signal?.throwIfAborted();
    await tar.c({ cwd: payload, file: archivePath, gzip: true, portable: true, strict: true, signal }, ["manifest.json", "RESTORE.txt", ...names]);
    await rm(payload, { recursive: true, force: true });
    return { archivePath, manifest, bytes: (await stat(archivePath)).size, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function unpackAndVerify(archivePath, destination) {
  const seen = new Set();
  let invalid = false;
  // 同一遍读取中拒绝路径穿越、重复条目与链接；仅解压允许的普通文件。
  await tar.x({
    file: archivePath, cwd: destination, strict: true, noChmod: true, noMtime: true,
    filter: (name, entry) => {
      const allowed = safePath(name) && (payloadPath(name) || name === "manifest.json" || name === "RESTORE.txt");
      if (!allowed || entry.type !== "File" || seen.has(name) || (name === "manifest.json" && entry.size > 16 * 1024 * 1024)) {
        invalid = true;
        return false;
      }
      seen.add(name);
      return true;
    },
  });
  if (invalid) throw new Error("备份包包含不支持的路径、链接或重复文件");
  const manifest = JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8"));
  if (manifest.format !== FORMAT || manifest.version !== VERSION || manifest.storage !== "local" || !Array.isArray(manifest.files)) {
    throw new Error("备份格式或版本不受支持");
  }
  const listed = new Set();
  for (const file of manifest.files) {
    if (!file || !payloadPath(file.path) || listed.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) || !seen.has(file.path)) {
      throw new Error("备份清单不完整或无效");
    }
    listed.add(file.path);
    const actual = await checksum(path.join(destination, file.path));
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error(`文件校验失败：${file.path}`);
  }
  if (!listed.has("journal.db") || [...seen].some((name) => payloadPath(name) && !listed.has(name))) {
    throw new Error("备份文件与清单不一致");
  }
  const counts = inspectDatabase(path.join(destination, "journal.db"), listed);
  if (!manifest.counts || manifest.counts.entries !== counts.entries || manifest.counts.media !== counts.media
    || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error("备份清单的数量或时间无效");
  }
  return manifest;
}

/** 先在临时目录完成全部校验，绝不试写正在使用的数据库。 */
export async function verifyBackup(archivePath) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "planet-verify-"));
  try { return await unpackAndVerify(archivePath, directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function ensureEmpty(target) {
  try {
    if (!(await lstat(target)).isDirectory() || (await readdir(target)).length) {
      throw new Error("恢复目标 data 目录已有内容或是链接。请在未启动过网站的新安装中恢复；已有数据请先备份并移到别处。");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function restoreBackup(archivePath, dataDir) {
  const target = path.resolve(dataDir);
  await ensureEmpty(target);
  await mkdir(path.dirname(target), { recursive: true });
  // 与目标同一文件系统：校验完以目录改名完成恢复，中途失败不留下半份数据。
  const directory = await mkdtemp(path.join(path.dirname(target), ".planet-restore-"));
  try {
    const manifest = await unpackAndVerify(archivePath, directory);
    await rm(path.join(directory, "manifest.json"));
    await rm(path.join(directory, "RESTORE.txt"), { force: true });
    await mkdir(path.join(directory, "media"), { recursive: true });
    await ensureEmpty(target);
    await rmdir(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rename(directory, target);
    return manifest;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
