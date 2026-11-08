"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChatTeardropText,
  EnvelopeSimple,
  FilmSlate,
  Heart,
  HouseSimple,
  Images,
  Lock,
  Notebook,
  Path,
  PencilSimple,
  SquaresFour,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { SectionKey } from "@/lib/settings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { READER_NAME } from "@/lib/reader";

const TABS = [
  { href: "/", section: "home" as SectionKey, label: "首页", icon: HouseSimple, active: "bg-butter text-ink", desc: "在小星球的每一天" },
  { href: "/journal", section: "journal" as SectionKey, label: "手账", icon: Notebook, active: "bg-matcha text-ink", desc: "翻开一页页日常" },
  { href: "/album", section: "album" as SectionKey, label: "相册", icon: Images, active: "bg-mist text-ink", desc: "实况照片与回忆" },
  { href: "/letters", section: "letters" as SectionKey, label: "信箱", icon: EnvelopeSimple, active: "bg-rose-soft text-rose-deep", desc: "封着火漆的信" },
  { href: "/quotes", section: "quotes" as SectionKey, label: "语录", icon: ChatTeardropText, active: "bg-peach text-ink", desc: "可爱的悄悄话" },
  { href: "/timeline", section: "timeline" as SectionKey, label: "大事记", icon: Path, active: "bg-butter text-ink", desc: "一路走来的脚印" },
  { href: "/screenings", section: "screenings" as SectionKey, label: "放映室", icon: FilmSlate, active: "bg-ink/10 text-ink", desc: "专属纪念视频" },
] as const;

type HeartDrop = { x: number; size: number; dur: number; delay: number; drift: number; rot: number };

/** 手账导航：
 *  - 桌面端：顶部手账彩色索引贴栏
 *  - 手机端：顶部轻巧书眉（爱心彩蛋 + 手账名 + 记一笔）+ 底部悬浮拇指坞（Dock）
 *  - 连点 5 下爱心触发爱心雨彩蛋 */
export function TopNav({
  title,
  author,
  reader = false,
  sections,
}: {
  title: string;
  author: boolean;
  /** 她本人（读者或作者）＝看得到全部栏目 */
  reader?: boolean;
  /** 各栏目对访客是否公开（读者登录后忽略） */
  sections?: Partial<Record<SectionKey, boolean>>;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const reduce = useReducedMotion();
  const [rain, setRain] = useState<{ id: number; drops: HeartDrop[] } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMoreOpen(false);
  }
  const taps = useRef<number[]>([]);
  const cooldownUntil = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onLogoTap() {
    const now = Date.now();
    taps.current = taps.current.filter((t) => now - t < 2500);
    taps.current.push(now);
    if (taps.current.length < 5 || now < cooldownUntil.current || reduce) return;
    taps.current = [];
    cooldownUntil.current = now + 20_000;
    const drops: HeartDrop[] = Array.from({ length: 26 }, () => ({
      x: 2 + Math.random() * 96,
      size: 14 + Math.random() * 16,
      dur: 2.4 + Math.random() * 1.4,
      delay: Math.random() * 0.9,
      drift: (Math.random() - 0.5) * 80,
      rot: (Math.random() - 0.5) * 50,
    }));
    setRain({ id: now, drops });
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setRain(null), 4500);
  }

  // 访客只看公开栏目；读者（她/作者）全看
  const visibleTabs = reader ? TABS : TABS.filter((t) => sections?.[t.section] === true);

  // 移动端底部主坞最多放 4 个核心栏目，多余的收进「更多」抽屉
  const useDrawer = visibleTabs.length > 4;
  const primaryTabs = useDrawer ? visibleTabs.slice(0, 4) : visibleTabs;
  const drawerTabs = useDrawer ? visibleTabs.slice(4) : [];
  const isDrawerActive = drawerTabs.some((t) => isActive(t.href));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-3.5 sm:h-16 sm:px-6">
          {/* 左侧：Logo 与手账名（移动端也优雅展示，绝不隐藏） */}
          <Link
            href="/"
            aria-label={title}
            onClick={onLogoTap}
            className="group flex min-w-0 items-center gap-2.5 transition active:scale-95"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rose-soft text-rose-deep shadow-sm transition-transform duration-300 ease-spring group-hover:scale-110">
              <Heart weight="fill" className="size-4.5" />
            </span>
            <span className="truncate font-hand text-lg font-bold text-ink sm:text-xl">{title}</span>
          </Link>

          {/* 桌面端：手账索引贴栏（md+ 显示） */}
          <div className="relative hidden min-w-0 flex-1 items-center justify-end md:flex">
            <div className="flex items-center gap-1.5 overflow-x-auto sm:gap-2">
              {visibleTabs.map(({ href, label, icon: Icon, active }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
                    isActive(href)
                      ? cn(active, "-translate-y-px shadow-sm")
                      : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                  )}
                >
                  <Icon weight="fill" className="size-4 shrink-0" />
                  {label}
                </Link>
              ))}
              {author && (
                <Link
                  href="/write"
                  className={cn(
                    "ml-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold transition-all duration-300 ease-spring",
                    isActive("/write")
                      ? "-translate-y-px bg-rose-deep text-paper shadow-md"
                      : "bg-rose-soft text-rose-deep hover:-translate-y-px"
                  )}
                >
                  <PencilSimple weight="bold" className="size-4 shrink-0" />
                  记一笔
                </Link>
              )}
            </div>
          </div>

          {/* 右端操作区：作者记一笔（移动端快捷入口）+ 明暗切换 + 访客锁 */}
          <div className="flex shrink-0 items-center gap-1.5">
            {author && (
              <Link
                href="/write"
                aria-label="去写一笔"
                className="flex items-center gap-1 rounded-full bg-rose-deep px-2.5 py-1 text-xs font-bold text-paper shadow-sm transition-transform active:scale-95 md:hidden"
              >
                <PencilSimple weight="bold" className="size-3.5" />
                <span>记一笔</span>
              </Link>
            )}
            <ThemeToggle />
            {!reader && (
              <Link
                href="/lock"
                aria-label={`${READER_NAME}的专属入口`}
                title={`${READER_NAME}的专属：输密码进来`}
                className="grid size-8 place-items-center rounded-full text-rose-deep/70 transition hover:bg-rose-soft/60 hover:text-rose-deep"
              >
                <Lock weight="fill" className="size-4" />
              </Link>
            )}
          </div>
        </nav>
      </header>

      {/* 移动端底部手账索引坞（Mobile Bottom Tab Dock，md:hidden） */}
      <aside aria-label="移动端快捷导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(92,74,66,0.06)] backdrop-blur-lg md:hidden">
        <nav className="mx-auto flex h-14 max-w-md items-center justify-around px-2">
          {primaryTabs.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-bold transition-all duration-300",
                  active ? "text-rose-deep" : "text-ink-soft hover:text-ink active:scale-95"
                )}
              >
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full transition-colors",
                    active && "bg-rose-soft/80"
                  )}
                >
                  <Icon weight={active ? "fill" : "bold"} className="size-4.5" />
                </span>
                <span>{label}</span>
                {active && (
                  <motion.span
                    layoutId="dock-dot"
                    className="absolute -bottom-0.5 size-1 rounded-full bg-rose-deep"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </Link>
            );
          })}

          {/* 「更多」抽屉展开按钮 */}
          {useDrawer && (
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="展开更多手账栏目"
              aria-expanded={moreOpen}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-bold transition-all duration-300",
                moreOpen || isDrawerActive ? "text-rose-deep" : "text-ink-soft hover:text-ink active:scale-95"
              )}
            >
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full transition-colors",
                  (moreOpen || isDrawerActive) && "bg-rose-soft/80"
                )}
              >
                <SquaresFour weight={moreOpen || isDrawerActive ? "fill" : "bold"} className="size-4.5" />
              </span>
              <span>更多</span>
              {isDrawerActive && !moreOpen && (
                <span className="absolute -bottom-0.5 size-1 rounded-full bg-rose-deep" />
              )}
            </button>
          )}
        </nav>
      </aside>

      {/* 移动端「更多栏目」底部手账抽屉（Sheet） */}
      <AnimatePresence>
        {moreOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="absolute inset-0 bg-ink/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-ink/10 bg-paper px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3.5 shadow-2xl"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/20" />
              <div className="flex items-center justify-between pb-3 border-b border-ink/10">
                <div className="flex items-center gap-2">
                  <Sparkle weight="fill" className="size-4.5 text-rose-deep" />
                  <span className="font-hand text-lg font-bold text-ink">翻翻其他角落</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  aria-label="收起"
                  className="grid size-8 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5"
                >
                  <X weight="bold" className="size-4" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {drawerTabs.map(({ href, label, icon: Icon, active, desc }) => {
                  const itemActive = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border p-3 transition active:scale-95",
                        itemActive
                          ? "border-rose/50 bg-rose-soft/40 shadow-xs"
                          : "border-ink/10 bg-card hover:bg-paper"
                      )}
                    >
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", active)}>
                        <Icon weight="fill" className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-ink">{label}</p>
                        <p className="truncate font-hand text-xs text-ink-soft">{desc}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {author && (
                <div className="mt-4 pt-3 border-t border-ink/10 flex items-center justify-between">
                  <Link
                    href="/write"
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-deep py-2.5 font-bold text-paper shadow-sm active:scale-95"
                  >
                    <PencilSimple weight="bold" className="size-4" />
                    <span>打开写作后台</span>
                  </Link>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 爱心雨：纯装饰，挂在 header 外面 */}
      <AnimatePresence>
        {rain && (
          <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
            {rain.drops.map((d, i) => (
              <motion.span
                key={`${rain.id}-${i}`}
                className="absolute top-0 text-rose"
                style={{ left: `${d.x}%` }}
                initial={{ y: "-8vh", opacity: 0, rotate: d.rot }}
                animate={{ y: "112vh", opacity: [0, 1, 1], rotate: d.rot * 2, x: d.drift }}
                exit={{ opacity: 0 }}
                transition={{ duration: d.dur, delay: d.delay, ease: "easeIn" }}
              >
                <Heart weight="fill" style={{ width: d.size, height: d.size }} />
              </motion.span>
            ))}
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
