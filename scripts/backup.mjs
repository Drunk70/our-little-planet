import { constants, existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createBackup, restoreBackup, verifyBackup } from "./lib/backup.mjs";

const [action, archive, ...extra] = process.argv.slice(2);
try {
  if (!["create", "verify", "restore"].includes(action) || !archive || extra.length) {
    throw new Error("用法：npm run backup|backup:verify|restore -- 备份文件.tar.gz");
  }
  const archivePath = path.resolve(archive);
  const dataDir = path.resolve("data");
  if (action === "create") {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "1") throw new Error("演示模式不提供持久数据备份");
    const db = new Database(path.join(dataDir, "journal.db"), { readonly: true, fileMustExist: true });
    let backup;
    try {
      backup = await createBackup({ database: db, dataDir, storage: process.env.OSS_BUCKET ? "oss" : "local" });
      await copyFile(backup.archivePath, archivePath, constants.COPYFILE_EXCL);
      console.log(`备份已保存：${archivePath}`);
    } finally {
      db.close();
      await backup?.cleanup();
    }
  } else {
    const manifest = action === "verify" ? await verifyBackup(archivePath) : await restoreBackup(archivePath, dataDir);
    console.log(`${action === "verify" ? "完整性校验通过" : "恢复完成"}：${manifest.counts.entries} 条内容，${manifest.counts.media} 个媒体文件。备份时间：${manifest.createdAt}`);
    if (action === "restore") console.log("请配置 .env.local 后再启动网站；本地存储恢复请保持 OSS 配置为空，不要运行 seed。");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "备份操作失败");
  process.exitCode = 1;
}
