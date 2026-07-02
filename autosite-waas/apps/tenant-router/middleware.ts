import { NextRequest, NextResponse } from "next/server";

const RESERVED_HOSTS = ["www", "app", "dashboard", "api"];

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const url = request.nextUrl.clone();

  const currentHost =
    process.env.NODE_ENV === "production"
      ? hostname.replace(".autosite.com", "")
      : hostname.replace(".localhost:3000", "");

  if (
    url.pathname.startsWith("/_next") ||
    url.pathname.startsWith("/api") ||
    url.pathname === "/favicon.ico" ||
    RESERVED_HOSTS.includes(currentHost)
  ) {
    return NextResponse.next();
  }

  url.pathname = `/render-tenant/${currentHost}${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
