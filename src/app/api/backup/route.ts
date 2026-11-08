import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { isAuthor } from "@/lib/auth";
import { db, DATA_DIR } from "@/lib/db";
import { IS_DEMO } from "@/lib/demo";
import { storageMode } from "@/lib/storage";
import { createBackup } from "../../../../scripts/lib/backup.mjs";
import { version } from "../../../../package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

declare global {
  var __planetBackupBusy: boolean | undefined;
}

function message(text: string, status: number) {
  return new Response(`${text}\n\n请返回作者后台的「备份与迁移」页面。`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!(await isAuthor())) return message("请先输入作者口令。", 401);
  if (request.headers.get("sec-fetch-site") === "cross-site") return message("请从作者后台发起备份。", 403);
  if (IS_DEMO) return message("演示模式不提供数据备份。", 409);
  if (storageMode() !== "local") return message("当前下载仅支持本地存储。OSS 媒体需另行备份，不能只下载数据库。", 409);
  if (globalThis.__planetBackupBusy) return message("已有备份正在生成或下载，请稍后再试。", 409);
  globalThis.__planetBackupBusy = true;
  let backup: Awaited<ReturnType<typeof createBackup>> | undefined;
  try {
    backup = await createBackup({ database: db, dataDir: DATA_DIR, storage: storageMode(), appVersion: version, signal: request.signal });
    request.signal.throwIfAborted();
    const stream = createReadStream(backup.archivePath, { signal: request.signal });
    const completed = backup;
    stream.once("close", () => {
      void completed.cleanup().catch(() => console.error("备份临时文件清理失败")).finally(() => { globalThis.__planetBackupBusy = false; });
    });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="our-little-planet-${backup.manifest.createdAt.replace(/[:.]/g, "-")}.tar.gz"`,
        "Content-Length": String(backup.bytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    await backup?.cleanup().catch(() => undefined);
    globalThis.__planetBackupBusy = false;
    const detail = error instanceof Error ? error.message : "未知错误";
    console.error("备份失败：", detail);
    // 文件系统错误可能含服务器路径，不把它们直接带到下载页面。
    return message("备份没有完成，请确认磁盘空间充足、媒体文件齐全，并暂停编辑后重试。详细原因见服务器日志。", 500);
  }
}
