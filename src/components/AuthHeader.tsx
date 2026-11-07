"use client";

import { useSession, signOut } from "next-auth/react";

// Compact signed-in banner shown above every gated page. Because proxy.ts gates
// all app routes, a session is always present when this renders — but we guard
// anyway so it degrades gracefully.
export default function AuthHeader() {
  const { data: session } = useSession();
  const user = session?.user;
  if (!user) return null;

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
          <span className="hidden sm:inline text-slate-400">Signed in as</span>
          <span className="truncate font-medium text-slate-900">
            {user.email ?? user.name}
          </span>
        </div>
        <nav className="flex items-center gap-2 text-xs">
          <a href="/single" className="rounded-lg px-2 py-1 font-medium text-slate-600 hover:bg-slate-50">ฟอร์มทีละคน (กทม.)</a>
          <a href="/today" className="rounded-lg px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50">งานวันนี้</a>
        </nav>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
