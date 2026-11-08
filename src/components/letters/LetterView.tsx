"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PencilSimple, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { EntryText } from "@/components/journal/EntryText";
import { WashiTape } from "@/components/journal/WashiTape";
import { SeenStamp } from "@/components/marks/SeenStamp";
import { CommentBox, type ReplyItem } from "@/components/marks/CommentBox";

export type LetterData = {
  id: string;
  title: string | null;
  body: string;
  entryDate: string;
  mood: string | null;
  /** 她的已阅印章日期（ISO）；null/缺省 = 还没盖 */
  seenAt?: string | null;
  /** 她之前寄回来的话（游客看信时为空，评论只属于她） */
  replies?: ReplyItem[];
  /** 她本人（读者）才显示回话框；访客看公开信时没有 */
  reader?: boolean;
};

/** 拆信：信纸从信封里滑出，展开成全屏阅读态 */
export function LetterView({
  letter,
  author,
  onClose,
}: {
  letter: LetterData | null;
  author: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!letter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [letter, onClose]);

  return (
    <AnimatePresence>
      {letter && (
        <motion.div
          key="letter-overlay"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-0 backdrop-blur-sm sm:items-center sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={onClose}
        >
          <motion.article
            key={letter.id}
            className={cn(
              "letter-paper relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl px-5 pb-16 pt-5 shadow-lifted sm:max-h-[85dvh] sm:rounded-2xl sm:px-12 sm:pt-8"
            )}
            initial={reduce ? false : { y: 80, opacity: 0, scale: 0.96, rotate: -1 }}
            animate={{ y: 0, opacity: 1, scale: 1, rotate: 0 }}
            exit={reduce ? { opacity: 0 } : { y: 60, opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <WashiTape tone="rose" rotate={-5} className="-top-3 left-1/2" />

            {/* 吸顶操作条：无论信多长，随时一键「折好放回」 */}
            <div className="sticky top-0 z-20 -mx-5 -mt-5 mb-5 flex items-center justify-between border-b border-ink/10 bg-paper-warm/95 px-5 py-2.5 backdrop-blur-sm sm:-mx-12 sm:-mt-8 sm:px-12 sm:py-3">
              <div className="flex items-center gap-2">
                {author && (
                  <Link
                    href={`/write?edit=${letter.id}`}
                    aria-label="编辑这封信"
                    title="编辑这封信"
                    className="grid size-8 place-items-center rounded-full text-ink-soft/70 transition hover:bg-ink/10 hover:text-ink"
                  >
                    <PencilSimple className="size-4" />
                  </Link>
                )}
                <span className="font-hand text-xs text-ink-soft">写给你的信</span>
              </div>
              <button
                type="button"
                aria-label="折好放回"
                onClick={onClose}
                className="flex items-center gap-1 rounded-full bg-ink/10 px-3 py-1 font-hand text-xs font-bold text-ink transition hover:bg-ink/20 active:scale-95"
              >
                <span>折好放回</span>
                <X weight="bold" className="size-3.5" />
              </button>
            </div>

            <p className="font-script text-3xl leading-none text-rose-deep">
              {letter.entryDate.replaceAll("-", ".")}
            </p>
            <h2 className="mt-3 text-3xl font-bold">{letter.title ?? "写给你"}</h2>

            <div className="mt-8">
              <EntryText text={letter.body} lined />
            </div>

            <footer className="mt-10 flex items-end justify-between gap-4">
              {letter.reader !== false && <SeenStamp entryId={letter.id} seenAt={letter.seenAt ?? null} />}
              <p className="font-script text-3xl text-ink/85">always yours</p>
            </footer>

            {letter.reader !== false && <CommentBox entryId={letter.id} initial={letter.replies ?? []} />}
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
