"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password.");
    } else {
      router.push("/");
      router.refresh();
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Registration failed.");
      return;
    }
    // Auto-login after successful registration.
    const login = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (login?.error) {
      setError("Registered but login failed — try logging in.");
      setMode("login");
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="10" height="10" stroke="var(--accent)" strokeWidth="1.5" />
            <rect x="16" y="2" width="10" height="10" stroke="var(--accent)" strokeWidth="1.5" fill="var(--accent)" fillOpacity="0.15" />
            <rect x="2" y="16" width="10" height="10" stroke="var(--accent)" strokeWidth="1.5" fill="var(--accent)" fillOpacity="0.3" />
            <rect x="16" y="16" width="10" height="10" stroke="var(--amber)" strokeWidth="1.5" />
          </svg>
          <span className="auth-title">LEDGRS</span>
        </div>
        <div className="auth-sub">CRYPTO PORTFOLIO TERMINAL</div>

        <div className="auth-tabs">
          <button
            data-testid="auth-login-tab"
            className={`auth-tab${mode === "login" ? " active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            LOGIN
          </button>
          <button
            data-testid="auth-register-tab"
            className={`auth-tab${mode === "register" ? " active" : ""}`}
            onClick={() => { setMode("register"); setError(""); }}
          >
            REGISTER
          </button>
        </div>

        <form onSubmit={mode === "login" ? handleLogin : handleRegister} className="auth-form">
          <div className="field">
            <label>EMAIL</label>
            <input
              data-testid="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label>PASSWORD</label>
            <input
              data-testid="auth-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "Min. 8 characters" : ""}
            />
          </div>
          {mode === "register" && (
            <div className="field">
              <label>CONFIRM PASSWORD</label>
              <input
                data-testid="auth-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
              />
            </div>
          )}
          {error && <div className="auth-error" data-testid="auth-error">{error}</div>}
          <button className="btn-action btn-buy-action" data-testid="auth-submit" type="submit" disabled={loading}>
            {loading ? "..." : mode === "login" ? "LOGIN" : "CREATE ACCOUNT"}
          </button>
        </form>

        {mode === "login" && (
          <div className="auth-hint">
            Demo account: <code>demo@ledgrs.dev</code> / <code>demo1234</code>
          </div>
        )}
      </div>
    </div>
  );
}
