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

/** 拿起笔：作者口令，拿到写手账的权限（同时也算解开本子）。
 *  笔是限时的：默认 AUTHOR_SESSION_HOURS 小时后收回，勾了 remember 才 30 天 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    password?: string;
    remember?: boolean;
  } | null;
  const role = guardedLogin(req, body?.password, true);
  if (role instanceof NextResponse) return role;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTHOR_COOKIE, authorToken(), authorCookieOpts(body?.remember === true));
  res.cookies.set(READER_COOKIE, tokenFor("reader"), COOKIE_OPTS);
  return res;
}
