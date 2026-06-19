import type { NextAuthConfig } from "next-auth";

// Minimal config used by the Edge middleware — no DB or bcrypt imports.
export const authConfig: NextAuthConfig = {
  providers: [],
  pages: { signIn: "/auth" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage = nextUrl.pathname.startsWith("/auth");
      const isApiAuth = nextUrl.pathname.startsWith("/api/auth");

      if (isAuthPage || isApiAuth) return true;
      if (!isLoggedIn) {
        // API routes: return 401 JSON instead of redirect.
        if (nextUrl.pathname.startsWith("/api/")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        return false; // redirects to /auth via pages.signIn
      }
      return true;
    },
  },
};
