import { NextResponse, type NextRequest } from "next/server";

// "/" goes to /ko when Korean is the browser's first language, otherwise /en.
export function proxy(request: NextRequest) {
  const first = (request.headers.get("accept-language") ?? "").split(",")[0].trim().toLowerCase();
  const lang = first.startsWith("ko") ? "ko" : "en";
  return NextResponse.redirect(new URL(`/${lang}`, request.url));
}

export const config = {
  matcher: ["/"],
};
