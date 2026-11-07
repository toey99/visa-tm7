import { handlers } from "@/auth";

// Auth.js mounts all of its endpoints (sign-in, callback, sign-out, session,
// CSRF, error) under /api/auth/* via this single catch-all route handler.
export const { GET, POST } = handlers;
