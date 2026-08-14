import { NextRequest, NextResponse } from "next/server";

function getSubdomain(request: NextRequest): string {
  const host = request.headers.get("host") ?? "";
  // e.g. "tgs.bounce.report" → "tgs", "kenko.bounce.report" → "kenko"
  return host.split(".")[0];
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const subdomain = getSubdomain(request);

  // ── TGF / tgs.bounce.report ────────────────────────────────────────────────
  if (subdomain === "tgs") {
    const session = request.cookies.get("tgs_session");

    // Rewrite root → login or dashboard
    if (pathname === "/") {
      return NextResponse.rewrite(new URL(session ? "/tgs/dashboard" : "/tgs/login", request.url));
    }
    // Rewrite /login → /tgs/login
    if (pathname === "/login") {
      return NextResponse.rewrite(new URL("/tgs/login", request.url));
    }
    // Rewrite /dashboard → /tgs/dashboard
    if (pathname.startsWith("/dashboard")) {
      if (!session) return NextResponse.redirect(new URL("/login", request.url));
      return NextResponse.rewrite(new URL("/tgs/dashboard", request.url));
    }
    // Pass through /api/* so fetch calls work on the same host
    return;
  }

  // ── Kenko / kenko.bounce.report (default) ─────────────────────────────────
  const session = request.cookies.get("kenko_session");
  if (pathname.startsWith("/dashboard") && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login", "/tgs/:path*"],
};
