import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── TGF / The Gift Studio ──────────────────────────────────────────────────
  if (pathname.startsWith("/tgs")) {
    const session = request.cookies.get("tgs_session");
    if (pathname.startsWith("/tgs/dashboard") && !session) {
      return NextResponse.redirect(new URL("/tgs/login", request.url));
    }
    if (pathname === "/tgs/login" && session) {
      return NextResponse.redirect(new URL("/tgs/dashboard", request.url));
    }
    return; // let Next.js handle all other /tgs/* routes
  }

  // ── Kenko (default) ────────────────────────────────────────────────────────
  const session = request.cookies.get("kenko_session");
  if (pathname.startsWith("/dashboard") && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/tgs/:path*"],
};
