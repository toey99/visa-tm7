// =============================================================
// Proxy (Next.js 16) — session enforcement across the app
// =============================================================
// NOTE: In Next.js 16 the `middleware.ts` convention is DEPRECATED and renamed
// to `proxy.ts` (the exported function must be named `proxy`). Using the old
// name still works but logs a build-time deprecation warning. Proxy now
// defaults to the Node.js runtime, so the full Auth.js config runs here with no
// edge-compatibility split.
//
// Re-exporting `auth` as `proxy` runs the `authorized` callback in auth.ts on
// every matched request: unauthenticated visitors are redirected to sign in.
export { auth as proxy } from "@/auth";

export const config = {
  // Gate everything EXCEPT the Auth.js endpoints (which must stay public so
  // users can actually sign in), Next.js internals, and static asset files.
  // App pages, /api/generate-tm7, and the Gemini server actions are all gated.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|ttf|woff2?|pdf)$).*)",
  ],
};
