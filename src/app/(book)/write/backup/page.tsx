import type { Metadata } from "next";
import Link from "next/link";
import { isAuthor } from "@/lib/auth";
import { storageMode } from "@/lib/storage";
import { IS_DEMO } from "@/lib/demo";
import { PenGate } from "@/components/write/PenGate";

export const metadata: Metadata = { title: "备份与迁移" };

export default async function BackupPage() {
  if (!(await isAuthor())) return <PenGate />;
  const supported = storageMode() === "local" && !IS_DEMO;
  return (
    <div className="mx-auto max-w-3xl py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">备份与迁移</h1>
        <Link href="/write" className="link-soft text-sm">回到写作后台</Link>
      </header>
      <section className="card-paper mt-7 space-y-4">
        <h2 className="text-xl font-bold">把这本手账带走</h2>
        <p className="leading-relaxed text-ink-soft">
          下载全部已保存的记录、照片、视频、语音和本子设置。换服务器时，用这一份备份恢复即可。
        </p>
        {supported ? (
          <>
            <form action="/api/backup" method="post" target="_blank">
              <button type="submit" className="btn-primary">下载完整备份</button>
            </form>
            <p className="text-sm leading-relaxed text-ink-soft">
              准备好后会开始浏览器下载，照片和视频多时需要等一会儿。期间请暂停新增、修改和删除，
              并等浏览器显示下载完成。失败原因会在新页面提示。
            </p>
          </>
        ) : (
          <p className="text-rose-deep">
            {IS_DEMO ? "演示模式不提供数据备份。" : "目前使用云端媒体存储，需要同时备份云端文件；此下载入口暂不支持。"}
          </p>
        )}
        <p className="text-sm leading-relaxed text-ink-soft">
          备份包含私密记录，请存到自己的电脑或移动硬盘，并保留多份。登录密码和服务器配置需另外保存。
        </p>
      </section>
      <section className="card-paper mt-6 space-y-4">
        <h2 className="text-xl font-bold">换服务器时</h2>
        <ol className="list-decimal space-y-3 pl-5 leading-relaxed text-ink-soft">
          <li>旧服务器到期前下载备份，确认完整性校验通过。</li>
          <li>新服务器安装项目后，上传备份包，按包内说明执行恢复命令，再启动网站。</li>
          <li>检查记录、照片和视频都能打开后，再把域名指向新服务器。</li>
        </ol>
        <p className="text-sm text-ink-soft">恢复工具会先校验文件，并拒绝覆盖已有数据。具体命令随备份一起保存。</p>
      </section>
    </div>
  );
}
