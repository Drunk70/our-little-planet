"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";
import { CaptionQuickEdit, MediaDateEdit, MediaDeleteButton } from "@/components/CaptionQuickEdit";

export type LightboxPhoto = {
  id: string;
  url: string;
  /** 照片墙用的 480px WebP 缩略图（灯箱本体始终用 url 原图，这个字段给墙上的卡用） */
  thumbUrl?: string | null;
  caption: string | null;
  entryDate: string;
  width: number | null;
  height: number | null;
  kind?: "photo" | "video";
  hevc?: boolean | null;
  liveVideo?: string | null;
  /** 视频封面（服务端抽的第一帧），播放前的占位图 */
  posterUrl?: string | null;
  /** 所属照片条目 id：判断「这组的第一张」用（墙上贴便利贴） */
  eid?: string | null;
  /** 「存照片」时写的那句话，灯箱里小字展示 */
  note?: string | null;
  /** 相册标签 */
  tags?: string[];
};

/** 大图灯箱：Esc 关闭、左右键翻页；实况照片可点 LIVE 回放。
 *  作者（过完 /write 认证）开着 canEdit 时，描述能当场改当场存；
 *  canEditDate 开着还能改这张自己的日期（相册墙用：改完照片挪到那天的页面） */
export function Lightbox({
  photos,
  index,
  onClose,
  onNav,
  canEdit = false,
  canEditDate = false,
  canDelete = false,
  onCaptionChange,
  onDateChange,
  onDelete,
}: {
  photos: LightboxPhoto[];
  index: number | null;
  onClose: () => void;
  onNav: (next: number) => void;
  canEdit?: boolean;
  canEditDate?: boolean;
  canDelete?: boolean;
  onCaptionChange?: (id: string, caption: string | null) => void;
  onDateChange?: (id: string, date: string) => void;
  onDelete?: (id: string) => void;
}) {
  const open = index !== null && index >= 0 && index < photos.length;
  const photo = open ? photos[index!] : null;
  const isVideo = Boolean(photo && photo.kind === "video");
  // 改过的日期记在灯箱本地（photos 是父层传的 prop，父层没接回调时至少当场显示对）
  const [dateById, setDateById] = useState<Record<string, string>>({});
  // portal 到 body 用：首帧（SSR/hydration）不渲染，挂载后再挂
  const mounted = useMounted();
  // 派生状态：切到别的照片时回放自动失效，无需 effect
  const [live, setLive] = useState<{ id: string; on: boolean }>({ id: "", on: false });
  const livePlaying = Boolean(photo && !isVideo && photo.liveVideo && live.id === photo.id && live.on);
  const liveRef = useRef<HTMLVideoElement>(null);
  // live 视频预取成内存 blob：点「LIVE 回放」零缓冲（302 签名地址不可缓存，按需拉会很卡）。
  //  blob 记上照片 id：换照片的瞬间还没预取完时先退回直连地址，不会播错
  const [liveBlobSrc, setLiveBlobSrc] = useState<{ id: string; url: string } | null>(null);
  const [liveWarming, setLiveWarming] = useState(false);
  const [videoErr, setVideoErr] = useState<{ id: string }>({ id: "" });
  const videoBroken = Boolean(photo && isVideo && videoErr.id === photo.id);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function playLive() {
    const v = liveRef.current;
    if (!v || !photo) return;
    if (livePlaying) {
      v.pause();
      setLive({ id: photo.id, on: false });
      return;
    }
    v.currentTime = 0;
    v.muted = false;
    setLive({ id: photo.id, on: true });
    setLiveWarming(true);
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }

  useEffect(() => {
    if (!photo?.liveVideo) return;
    const pid = photo.id;
    const direct = photo.liveVideo;
    let cancelled = false;
    let url: string | null = null;
    fetch(direct)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (cancelled || !b) return;
        url = URL.createObjectURL(b);
        setLiveBlobSrc({ id: pid, url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.id, photo?.liveVideo]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (index === null || photos.length === 0) return;
      onNav((index + dir + photos.length) % photos.length);
    },
    [index, photos.length, onNav]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 正在改描述时 Esc / 方向键留给输入框（关灯箱、翻页都先靠边）
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, go]);

  // 灯箱必须 portal 到 body 下：调用方大多把 <Lightbox> 渲染在卡片内部，
  // 带 transform 的祖先（Reveal 进场动画 / 拍立得倾斜角）会让 fixed 遮罩
  // 被困在卡片区域里并跟着卡片歪斜——看着像全屏，实际点击关闭会落空，
  // body 的滚动锁就再也解不开了
  const overlay = (
    <AnimatePresence>
      {photo && (
        <motion.div
          key="lightbox"
          className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
        >
          {/* 顶部常驻 HUD 栏：张数序号 + 日期 + 关闭按钮 */}
          <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between p-3 sm:p-5 pointer-events-none">
            <div className="flex items-center gap-2 rounded-full bg-ink/60 px-3.5 py-1 font-round text-xs font-bold tracking-widest text-paper shadow-md backdrop-blur-md pointer-events-auto">
              <span>{index! + 1} / {photos.length}</span>
              <span className="opacity-40">·</span>
              <span className="opacity-80">{(dateById[photo?.id ?? ""] ?? photo?.entryDate ?? "").replaceAll("-", ".")}</span>
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="grid size-10 place-items-center rounded-full bg-ink/60 text-paper shadow-md backdrop-blur-md transition hover:bg-ink/80 active:scale-95 pointer-events-auto sm:size-11"
            >
              <X weight="bold" className="size-5" />
            </button>
          </div>

          {/* 滚动区：矮窗口里「大图 + 描述」放不下时可以在灯箱内滚动 */}
          <div className="absolute inset-0 overflow-y-auto px-4 pb-8 pt-16 sm:p-8">
            <div className="flex min-h-full flex-col items-center justify-center gap-4">
              <motion.figure
                key={photo.id}
                className="relative flex max-h-full flex-col items-center [touch-action:pan-y]"
                initial={{ scale: 0.94, opacity: 0, rotate: -1 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => {
                  if (e.touches.length === 1) {
                    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
                    if (!isVideo && photo?.liveVideo) {
                      longPressTimer.current = setTimeout(() => {
                        playLive();
                      }, 300);
                    }
                  }
                }}
                onTouchMove={(e) => {
                  if (touchStart.current && e.touches.length === 1) {
                    const dx = e.touches[0].clientX - touchStart.current.x;
                    const dy = e.touches[0].clientY - touchStart.current.y;
                    if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
                      if (longPressTimer.current) {
                        clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                      }
                    }
                  }
                }}
                onTouchEnd={(e) => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                  const s = touchStart.current;
                  touchStart.current = null;
                  if (!s || e.changedTouches.length === 0) return;
                  const dx = e.changedTouches[0].clientX - s.x;
                  const dy = e.changedTouches[0].clientY - s.y;
                  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                    go(dx < 0 ? 1 : -1);
                    return;
                  }
                  if (dy > 70 && Math.abs(dy) > Math.abs(dx) * 1.6) {
                    onClose();
                  }
                }}
              >
                {isVideo ? (
                  <video
                    key={photo.id}
                    src={photo.url}
                    poster={photo.posterUrl ?? undefined}
                    controls
                    autoPlay
                    playsInline
                    onError={() => setVideoErr({ id: photo.id })}
                    className="max-h-[70vh] max-w-full rounded-lg bg-ink shadow-lifted"
                  />
                ) : (
                  <div className="rounded-lg bg-white p-2.5 shadow-lifted sm:p-3">
                    <div className="relative select-none [-webkit-touch-callout:none]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={photo.caption ?? "我们的照片"}
                        draggable={false}
                        className="max-h-[70vh] max-w-full rounded-xs"
                      />
                      {photo.liveVideo && (
                        <video
                          ref={liveRef}
                          src={liveBlobSrc?.id === photo.id ? liveBlobSrc.url : photo.liveVideo}
                          playsInline
                          preload="auto"
                          onPlaying={() => setLiveWarming(false)}
                          onWaiting={() => setLiveWarming(true)}
                          onEnded={() => setLive({ id: photo.id, on: false })}
                          className={cn(
                            "absolute inset-0 h-full w-full object-cover transition-opacity duration-150",
                            livePlaying ? "opacity-100" : "pointer-events-none opacity-0"
                          )}
                        />
                      )}
                      {photo.liveVideo && !livePlaying && !liveWarming && (
                        <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1 rounded-full bg-ink/55 px-2 py-0.5 text-[10px] font-bold tracking-[0.18em] text-paper backdrop-blur">
                          <span className="size-1.5 rounded-full bg-rose" />
                          LIVE
                        </span>
                      )}
                      {liveWarming && (
                        <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-ink/55 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-paper backdrop-blur">
                          <span className="size-1.5 animate-pulse rounded-full bg-butter" />
                          实况加载中
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <figcaption className="mt-4 flex max-w-2xl flex-col items-center gap-2 text-paper">
                  {photo.note && (
                    <p className="max-w-lg text-center font-hand text-lg leading-relaxed opacity-80">{photo.note}</p>
                  )}
                  <div className="flex flex-wrap items-baseline justify-center gap-3">
                    {canEdit ? (
                      <CaptionQuickEdit
                        mediaId={photo.id}
                        caption={photo.caption}
                        onSaved={(c) => onCaptionChange?.(photo.id, c)}
                      />
                    ) : (
                      photo.caption && <span className="font-script text-3xl leading-none">{photo.caption}</span>
                    )}
                    {canEditDate && photo ? (
                      <MediaDateEdit
                        mediaId={photo.id}
                        date={dateById[photo.id] ?? photo.entryDate}
                        onSaved={(d) => {
                          setDateById((prev) => ({ ...prev, [photo.id]: d }));
                          onDateChange?.(photo.id, d);
                        }}
                      />
                    ) : (
                      <span className="font-round text-sm tracking-widest opacity-70">
                        {(dateById[photo?.id ?? ""] ?? photo?.entryDate ?? "").replaceAll("-", ".")}
                      </span>
                    )}
                    {canDelete && photo && (
                      <MediaDeleteButton
                        mediaId={photo.id}
                        onDeleted={() => {
                          onDelete?.(photo.id);
                          if (photos.length <= 1) onClose();
                        }}
                      />
                    )}
                    {(photo.tags ?? []).map((t) => (
                      <span key={t} className="rounded-full bg-paper/20 px-2 py-0.5 font-hand text-base leading-snug">
                        {t}
                      </span>
                    ))}
                    {!isVideo && photo.liveVideo && (
                      <button
                        type="button"
                        onClick={playLive}
                        className="rounded-full bg-rose-deep px-3.5 py-1 text-xs font-bold tracking-[0.15em] text-paper shadow-sm transition hover:opacity-85 active:scale-95"
                      >
                        {livePlaying ? "停止" : "LIVE 回放"}
                      </button>
                    )}
                  </div>
                </figcaption>
                {videoBroken && (
                  <p className="mt-2 max-w-md text-center font-round text-sm leading-relaxed text-paper/80">
                    这个浏览器放不了这段视频{photo?.hevc ? "（HEVC 编码）" : ""}，用 iPhone / Mac 打开没问题。
                  </p>
                )}
              </motion.figure>
            </div>
          </div>

          {/* 桌面端左右翻页浮钮（移动端使用手势左右划动与下拉关闭） */}
          <button
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-4 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-paper/20 text-paper backdrop-blur transition hover:bg-paper/35 active:scale-95 sm:grid"
          >
            <CaretLeft weight="bold" className="size-6" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-4 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-paper/20 text-paper backdrop-blur transition hover:bg-paper/35 active:scale-95 sm:grid"
          >
            <CaretRight weight="bold" className="size-6" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}
