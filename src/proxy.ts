import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ATTR_COOKIE, TOUCH_HEADER, VID_COOKIE, advanceAttribution, decodeAttribution, encodeAttribution, touchFromRequest } from "@/server/analytics/attribution";
import { isReferralCode } from "@/server/referrals/code";
import { TELEGRAM_LINK_STATE_COOKIE, TELEGRAM_LINK_STATE_HEADER, resolveTelegramLinkState } from "@/server/telegram/link-state";

const YEAR_SECONDS = 400 * 24 * 60 * 60;
const REF_COOKIE = "ref";
const REF_MAX_AGE = 30 * 24 * 60 * 60;

export function proxy(request: NextRequest) {
  const existing = decodeAttribution(request.cookies.get(ATTR_COOKIE)?.value);
  const visitorId = request.cookies.get(VID_COOKIE)?.value ?? null;
  const touch = touchFromRequest({
    pathname: request.nextUrl.pathname,
    searchParams: request.nextUrl.searchParams.entries(),
    referrer: request.headers.get("referer"),
    requestHost: request.nextUrl.host,
  });
  const { state, write } = advanceAttribution(existing, visitorId, touch);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TOUCH_HEADER);
  requestHeaders.delete(TELEGRAM_LINK_STATE_HEADER);
  if (write) requestHeaders.set(TOUCH_HEADER, encodeAttribution(state));
  const telegramLink = resolveTelegramLinkState(request.nextUrl.pathname, request.cookies.get(TELEGRAM_LINK_STATE_COOKIE)?.value);
  if (telegramLink) requestHeaders.set(TELEGRAM_LINK_STATE_HEADER, telegramLink.state);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR_SECONDS,
  };
  if (visitorId !== state.visitorId) response.cookies.set(VID_COOKIE, state.visitorId, cookie);
  if (write) response.cookies.set(ATTR_COOKIE, encodeAttribution(state), cookie);

  const refParam = request.nextUrl.searchParams.get("ref");
  const ref = refParam?.trim().toUpperCase();
  if (telegramLink?.cookie) {
    response.cookies.set(telegramLink.cookie.name, telegramLink.cookie.value, {
      httpOnly: telegramLink.cookie.httpOnly,
      sameSite: telegramLink.cookie.sameSite,
      path: telegramLink.cookie.path,
      maxAge: telegramLink.cookie.maxAge,
      secure: telegramLink.cookie.secure,
    });
  }

  if (ref && isReferralCode(ref)) {
    response.cookies.set(REF_COOKIE, ref, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REF_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
