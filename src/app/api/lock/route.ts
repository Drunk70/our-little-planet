import { NextResponse } from "next/server";
import {
  AUTHOR_COOKIE,
  COOKIE_OPTS,
  READER_COOKIE,
  authorCookieOpts,
  authorToken,
  tokenFor,
} from "@/lib/auth";
import { guardedLogin } from "@/lib/loginGuard";

export const runtime = "nodejs";

/** 解锁：读者密码或作者口令都能翻开本子；作者口令同时拿到笔。
 *  作者会话是限时的（默认 AUTHOR_SESSION_HOURS 小时，勾 remember 才 30 天），
 *  读者会话照旧长期有效 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    password?: string;
    remember?: boolean;
  } | null;
  const role = guardedLogin(req, body?.password);
  if (role instanceof NextResponse) return role;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(READER_COOKIE, tokenFor("reader"), COOKIE_OPTS);
  if (role === "author") {
    res.cookies.set(AUTHOR_COOKIE, authorToken(), authorCookieOpts(body?.remember === true));
  }
  return res;
}

/** 合上本子 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(READER_COOKIE);
  res.cookies.delete(AUTHOR_COOKIE);
  return res;
}
