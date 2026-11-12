import { DoodleDivider } from "./journal/DoodleDivider";
import { LockButton } from "./LockButton";

/** 页脚：她本人能「合上本子」退出登录；访客的入口在导航栏右上的小锁，这里不重复放 */
export function SiteFooter({ reader = false }: { reader?: boolean }) {
  const icpRecord = process.env.ICP_RECORD_NUMBER?.trim();

  return (
    <footer className="mt-14 pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:mt-20 sm:pb-16">
      <DoodleDivider variant="hearts" className="mx-auto mb-8 w-40" />
      <div className="flex flex-col items-center gap-4">
        {reader && <LockButton />}
        <p className="font-script text-2xl text-ink-soft/70">written with love, kept with care</p>
        {icpRecord && (
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-ink-soft/70 underline-offset-4 hover:underline"
          >
            {icpRecord}
          </a>
        )}
      </div>
    </footer>
  );
}
