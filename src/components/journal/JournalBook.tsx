"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { EntryWithMedia } from "@/lib/entries";
import { JournalEntryCard } from "./JournalEntryCard";
import { JournalDatePicker, getWeekdayName } from "./JournalDatePicker";

/** 翻书动画：从右侧翻进来（下一页/更早）或从左侧翻回来（上一页/更新） */
const FLIP = {
  enter: (d: number) => ({ x: d >= 0 ? 90 : -90, rotateY: d >= 0 ? -10 : 10, opacity: 0 }),
  center: { x: 0, rotateY: 0, opacity: 1 },
  exit: (d: number) => ({ x: d >= 0 ? -90 : 90, rotateY: d >= 0 ? 10 : -10, opacity: 0 }),
};

/** 手账本：像翻纸质书一样一页一页看（手账页 + 自由拼贴页），
 *  月份贴纸跳转 + 日历直选某天；←→ 键、按钮、左右滑动都能翻；
 *  带 ?date= 进来时先翻到那一天（首页「回到那几天」用） */
export function JournalBook({ entries, author, reader = false, initialDate, seens }: { entries: EntryWithMedia[]; author: boolean; reader?: boolean; initialDate?: string; seens?: Record<string, string> }) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0); // 0 = 最新一页，往后翻是更早的
  const [dir, setDir] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const monthBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const safeIdx = Math.min(Math.max(idx, 0), entries.length - 1);
  const entry = entries[safeIdx];

  const allEntryDates = useMemo(() => entries.map((e) => e.entry_date), [entries]);

  const months = useMemo(() => {
    const m = new Map<string, number>(); // 月份 → 该月最新一页的下标
    entries.forEach((e, i) => {
      const k = e.entry_date.slice(0, 7);
      if (!m.has(k)) m.set(k, i);
    });
    return [...m.entries()]; // entries 本身按日期倒序，先见到的即该月最新
  }, [entries]);

  function go(d: 1 | -1) {
    const next = Math.min(Math.max(safeIdx + d, 0), entries.length - 1);
    if (next === safeIdx) return;
    setDir(d);
    setIdx(next);
  }

  function jumpTo(i: number) {
    if (i === safeIdx || i < 0 || i >= entries.length) return;
    setDir(i > safeIdx ? 1 : -1);
    setIdx(i);
  }

  /** 跳到某天：有当天的页就翻到（多页取最新），没有就翻到它之前最近的一页 */
  function jumpToDate(dateStr: string) {
    if (!dateStr) return;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].entry_date <= dateStr) {
        jumpTo(i);
        return;
      }
    }
    jumpTo(entries.length - 1); // 比所有页都早，翻到第一页（最旧）
  }

  // 翻页或滑动切页时，顶部的月份索引贴自动平滑滚动聚焦到中央
  const currentEntryDate = entry?.entry_date;
  useEffect(() => {
    if (!currentEntryDate) return;
    const currentMonth = currentEntryDate.slice(0, 7);
    const btn = monthBtnRefs.current.get(currentMonth);
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [currentEntryDate]);

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, entries.length]);

  // 带日期进来：翻到那一天（没有当天的页就翻到它之前最近的一页），只翻这一次
  const dateJumped = useRef(false);
  useEffect(() => {
    if (dateJumped.current || !initialDate || entries.length === 0) return;
    dateJumped.current = true;
    jumpToDate(initialDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate, entries.length]);

  return (
    <div className="mt-6 sm:mt-12">
      {/* 顶部手账书签导航：左侧当前翻开日期徽章（可点开自定义日历） + 右侧月份滑轨 */}
      <div className="flex items-center justify-between gap-2.5">
        <JournalDatePicker
          value={entry.entry_date}
          onChange={jumpToDate}
          highlightDates={allEntryDates}
          minDate={entries[entries.length - 1]?.entry_date}
          maxDate={entries[0]?.entry_date}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              title="点击打开手账日历直选日期"
              className="group flex shrink-0 items-center gap-2 rounded-2xl border border-ink/15 bg-card px-2.5 py-1.5 shadow-xs transition-all active:scale-95 hover:border-rose/50 hover:shadow-card sm:px-3 sm:py-1.5"
            >
              <span className="grid size-7 place-items-center rounded-xl bg-rose-soft/80 text-rose-deep transition-transform group-hover:scale-105">
                <CalendarBlank weight="fill" className="size-4" />
              </span>
              <div className="flex flex-col text-left leading-none">
                <span className="font-round text-xs font-bold tracking-wider text-ink sm:text-sm">
                  {entry.entry_date.replaceAll("-", ".")}
                </span>
                <span className="mt-1 font-hand text-[10px] text-ink-soft">
                  {getWeekdayName(entry.entry_date)} · 选日期
                </span>
              </div>
            </button>
          )}
        />

        {/* 月份索引滑轨：随翻页自动平滑居中聚焦 */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 sm:gap-2">
          {months.map(([m, i]) => {
            const isCurrent = entry.entry_date.startsWith(m);
            const [y, mo] = m.split("-");
            return (
              <button
                key={m}
                ref={(el) => {
                  if (el) monthBtnRefs.current.set(m, el);
                  else monthBtnRefs.current.delete(m);
                }}
                type="button"
                onClick={() => jumpTo(i)}
                className={cn(
                  "shrink-0 flex items-center rounded-full px-3 py-1.5 text-xs font-bold transition-all duration-300 ease-spring sm:px-3.5 sm:text-sm",
                  isCurrent
                    ? "-translate-y-px bg-rose-deep text-paper shadow-md"
                    : "border border-ink/15 bg-card/60 text-ink-soft hover:bg-ink/5 hover:text-ink"
                )}
              >
                <span className={cn("mr-0.5 font-round text-[10px]", isCurrent ? "text-paper/80" : "text-ink-soft/70")}>
                  {y}·
                </span>
                <span>{Number(mo)}月</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 书页 */}
      <div className="relative mt-6 sm:mt-8">
        <AnimatePresence custom={dir} mode="wait" initial={false}>
          <motion.div
            key={entry.id}
            custom={dir}
            variants={FLIP}
            initial="enter"
            animate="center"
            exit="exit"
            transition={reduce ? { duration: 0.15 } : { duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformPerspective: 1400 }}
            className="mx-auto max-w-2xl [touch-action:pan-y]"
            onPointerDown={(e) => {
              swipe.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s) return;
              const dx = e.clientX - s.x;
              const dy = e.clientY - s.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
            }}
            onPointerCancel={() => {
              swipe.current = null;
            }}
          >
            <JournalEntryCard entry={entry} author={author} reader={reader} seenAt={seens?.[entry.id] ?? null} />
          </motion.div>
        </AnimatePresence>

        {/* 桌面端悬浮翻页按钮（移动端隐藏，避免遮挡内容） */}
        <button
          type="button"
          aria-label="上一页（更新的）"
          disabled={safeIdx === 0}
          onClick={() => go(-1)}
          className="absolute -left-6 top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-paper text-ink-soft shadow-card transition hover:text-ink disabled:opacity-30 sm:grid sm:-left-8"
        >
          <CaretLeft weight="bold" className="size-5" />
        </button>
        <button
          type="button"
          aria-label="下一页（更早的）"
          disabled={safeIdx === entries.length - 1}
          onClick={() => go(1)}
          className="absolute -right-6 top-1/2 z-10 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-ink/10 bg-paper text-ink-soft shadow-card transition hover:text-ink disabled:opacity-30 sm:grid sm:-right-8"
        >
          <CaretRight weight="bold" className="size-5" />
        </button>
      </div>

      {/* 移动端专属：底部手账翻页控制器（拇指热区控制） */}
      <div className="mt-5 flex items-center justify-between gap-3 sm:hidden">
        <button
          type="button"
          disabled={safeIdx === 0}
          onClick={() => go(-1)}
          className="flex items-center gap-1 rounded-full border border-ink/15 bg-card px-3.5 py-2 font-hand text-xs font-bold text-ink shadow-xs active:scale-95 disabled:opacity-30"
        >
          <CaretLeft weight="bold" className="size-3.5" />
          上一页
        </button>

        <div className="flex flex-col items-center">
          <span className="font-round text-xs font-bold tracking-widest text-ink">
            {safeIdx + 1} / {entries.length} 页
          </span>
          <span className="font-round text-[11px] tracking-wider text-ink-soft">
            {entry.entry_date.replaceAll("-", ".")}
          </span>
        </div>

        <button
          type="button"
          disabled={safeIdx === entries.length - 1}
          onClick={() => go(1)}
          className="flex items-center gap-1 rounded-full border border-ink/15 bg-card px-3.5 py-2 font-hand text-xs font-bold text-ink shadow-xs active:scale-95 disabled:opacity-30"
        >
          下一页
          <CaretRight weight="bold" className="size-3.5" />
        </button>
      </div>

      {/* 桌面端页码与提示 */}
      <p className="mt-6 hidden flex-wrap items-center justify-center gap-x-3 gap-y-1 font-round text-sm tracking-widest text-ink-soft sm:flex">
        <span>
          {safeIdx + 1} / {entries.length} 页
        </span>
        <span className="opacity-60">·</span>
        <span className="opacity-70">{entry.entry_date.replaceAll("-", ".")}</span>
        <span className="opacity-60">·</span>
        <span className="opacity-50">← → 键或左右滑动翻页</span>
      </p>
    </div>
  );
}
