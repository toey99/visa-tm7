import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// =============================================================
// Auth.js (NextAuth v5) — Google sign-in gated by an email allow-list
// =============================================================
// This app has no database, so we use the default stateless JWT session
// strategy (no adapter required). Two callbacks enforce access:
//   • signIn     — identity gate: only allow-listed emails may sign in.
//   • authorized — request gate: proxy.ts uses this to require a session.
// =============================================================

/**
 * Comma-separated allow-list of Google account emails permitted to sign in,
 * read from AUTH_ALLOWED_EMAILS, e.g.
 *   AUTH_ALLOWED_EMAILS="alice@gmail.com, bob@company.com"
 *
 * Matching is case-insensitive. If the list is empty the app is FAIL-CLOSED
 * (no one can sign in) — deliberate, so a misconfigured deploy never opens up.
 */
const allowedEmails = new Set(
  (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosting behind a reverse proxy (your Linux production plan): trust the
  // forwarded host header. Alternatively drop this and set AUTH_TRUST_HOST=true.
  trustHost: true,
  providers: [Google],
  callbacks: {
    /**
     * Identity gate. Runs when a user completes Google OAuth. Returning false
     * sends them to the Auth.js AccessDenied page. We require the Google
     * provider, a present + verified email, and allow-list membership.
     */
    signIn({ account, profile, user }) {
      if (account?.provider !== "google") return false;
      const email = (profile?.email ?? user.email ?? "").toLowerCase();
      const emailVerified = (profile as { email_verified?: boolean } | null)
        ?.email_verified;
      if (!email || emailVerified === false) return false;
      return allowedEmails.has(email);
    },
    /**
     * Request gate. Invoked by the `auth` wrapper re-exported from proxy.ts for
     * every matched route. Returning false makes Auth.js redirect page requests
     * to the sign-in screen (and blocks API requests without a session).
     */
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
});
