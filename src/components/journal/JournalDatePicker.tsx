"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarBlank, CaretLeft, CaretRight, Heart, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { WashiTape } from "./WashiTape";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function fmtYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function getWeekdayName(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  const names = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return names[dt.getDay()] ?? "";
}

/** 手账专属手绘风日历选择器：
 *  彻底取代浏览器原生丑陋的 <input type="date">，
 *  拥有纸质手账的质感、翻月动效、爱心标记（有日记/照片的日子）与直观的点选体验。 */
export function JournalDatePicker({
  value,
  onChange,
  highlightDates = [],
  minDate,
  maxDate,
  trigger,
}: {
  value?: string;
  onChange: (date: string) => void;
  /** 有日记/照片的日期集合（带爱心标记） */
  highlightDates?: string[];
  minDate?: string;
  maxDate?: string;
  /** 自定义触发按钮，默认给出一枚手账邮戳按钮 */
  trigger?: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // 初始化查看的年月：优先当前选中值，其次最新 highlightDate，再次今天
  const initialDate = value || highlightDates[0] || new Date().toISOString().slice(0, 10);
  const [view, setView] = useState(() => ({
    y: Number(initialDate.slice(0, 4)) || new Date().getFullYear(),
    m: (Number(initialDate.slice(5, 7)) || new Date().getMonth() + 1) - 1,
  }));

  const monthKey = `${view.y}-${String(view.m + 1).padStart(2, "0")}`;

  // 命中当前查看月份的有日记/照片日期
  const entryDaySet = useMemo(() => {
    const set = new Set<number>();
    for (const d of highlightDates) {
      if (d.startsWith(monthKey)) {
        set.add(Number(d.slice(8, 10)));
      }
    }
    return set;
  }, [highlightDates, monthKey]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta: 1 | -1) {
    setView((v) => {
      const nextM = v.m + delta;
      if (nextM < 0) return { y: v.y - 1, m: 11 };
      if (nextM > 11) return { y: v.y + 1, m: 0 };
      return { ...v, m: nextM };
    });
  }

  function pickDate(day: number) {
    const ymd = fmtYmd(view.y, view.m, day);
    onChange(ymd);
    setOpen(false);
  }

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-card px-3 py-1.5 shadow-xs transition hover:border-rose/50 active:scale-95"
        >
          <CalendarBlank weight="fill" className="size-4 text-rose-deep" />
          <span className="font-round text-xs font-bold text-ink sm:text-sm">
            {value ? value.replaceAll("-", ".") : "选日期"}
          </span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* 遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-ink/50 backdrop-blur-xs"
            />

            {/* 日历卡片 */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="card-paper relative z-10 w-full max-w-sm p-6 shadow-lifted"
            >
              <WashiTape tone="rose" rotate={-4} className="-top-3 left-1/2" />

              {/* 顶部标题与关闭 */}
              <div className="flex items-center justify-between pb-3 border-b border-ink/10">
                <div className="flex items-center gap-1.5">
                  <Heart weight="fill" className="size-4 text-rose-deep" />
                  <span className="font-hand text-base font-bold text-ink">手账日历</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭日历"
                  className="grid size-7 place-items-center rounded-full text-ink-soft transition hover:bg-ink/10 hover:text-ink active:scale-90"
                >
                  <X weight="bold" className="size-4" />
                </button>
              </div>

              {/* 年月翻动栏 */}
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  aria-label="上个月"
                  className="grid size-8 place-items-center rounded-full border border-ink/15 text-ink-soft transition hover:bg-ink/5 hover:text-ink active:scale-90"
                >
                  <CaretLeft weight="bold" className="size-4" />
                </button>
                <div className="text-center">
                  <p className="font-round text-lg font-bold text-ink sm:text-xl">
                    {view.y} 年 {view.m + 1} 月
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="下个月"
                  className="grid size-8 place-items-center rounded-full border border-ink/15 text-ink-soft transition hover:bg-ink/5 hover:text-ink active:scale-90"
                >
                  <CaretRight weight="bold" className="size-4" />
                </button>
              </div>

              {/* 星期行 */}
              <div className="mt-4 grid grid-cols-7 text-center">
                {WEEKDAYS.map((w, idx) => (
                  <span
                    key={w}
                    className={cn(
                      "font-hand text-xs font-bold",
                      idx === 0 || idx === 6 ? "text-rose-deep/80" : "text-ink-soft/70"
                    )}
                  >
                    {w}
                  </span>
                ))}
              </div>

              {/* 日期格子 */}
              <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
                {cells.map((day, i) => {
                  if (day === null) {
                    return <div key={`empty-${i}`} className="h-9" />;
                  }
                  const ymd = fmtYmd(view.y, view.m, day);
                  const isSelected = value === ymd;
                  const hasEntry = entryDaySet.has(day);
                  const isOutOfRange = (minDate && ymd < minDate) || (maxDate && ymd > maxDate);

                  return (
                    <button
                      key={ymd}
                      type="button"
                      disabled={Boolean(isOutOfRange)}
                      onClick={() => pickDate(day)}
                      className={cn(
                        "relative mx-auto flex size-8 flex-col items-center justify-center rounded-full font-round text-xs font-bold transition-all sm:size-9 sm:text-sm",
                        isSelected
                          ? "bg-rose-deep text-paper shadow-sm"
                          : hasEntry
                          ? "bg-rose-soft/60 text-ink hover:bg-rose-soft"
                          : "text-ink hover:bg-ink/5",
                        isOutOfRange && "cursor-not-allowed opacity-25 hover:bg-transparent"
                      )}
                    >
                      <span>{day}</span>
                      {hasEntry && !isSelected && (
                        <span className="absolute bottom-0.5 size-1 rounded-full bg-rose-deep" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 底部提示与快捷操作 */}
              <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-3 text-xs">
                <div className="flex items-center gap-1 text-[11px] text-ink-soft">
                  <span className="size-1.5 rounded-full bg-rose-deep" />
                  <span>粉点 = 有记录的日子</span>
                </div>
                {highlightDates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(highlightDates[0]);
                      setOpen(false);
                    }}
                    className="font-hand font-bold text-rose-deep transition hover:underline"
                  >
                    回到最新一页
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
