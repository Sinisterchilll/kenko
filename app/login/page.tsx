"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function BounceLogo({ h = 22 }: { h?: number }) {
  return (
    <svg height={h} viewBox="0 0 140 36" fill="none" style={{ display: "block" }}>
      <rect x="2" y="3" width="30" height="30" rx="7" fill="#D4FF3A" />
      <path d="M10 11h9a4 4 0 0 1 0 8H10zm0 8h10a4 4 0 0 1 0 8H10z" fill="#0B0D0C" />
      <text x="40" y="25" fontFamily="Space Grotesk,sans-serif" fontWeight="700" fontSize="20" letterSpacing="-0.5" fill="white">bounce</text>
    </svg>
  );
}

function KenkoLogo({ h = 22 }: { h?: number }) {
  return (
    <svg height={h} viewBox="0 0 120 36" fill="none" style={{ display: "block" }}>
      <circle cx="17" cy="18" r="14" fill="#1A2E20" stroke="#2A4030" strokeWidth="1" />
      <path d="M11 22 C11 14, 19 10, 25 10 C25 18, 19 24, 11 22 Z" fill="#D4FF3A" opacity="0.85" />
      <path d="M12 21 C15 18, 19 15, 24 12" stroke="#1A2E20" strokeWidth="1.2" fill="none" />
      <text x="36" y="25" fontFamily="Space Grotesk,sans-serif" fontWeight="700" fontSize="20" letterSpacing="-0.5" fill="white">kenko</text>
    </svg>
  );
}

function DecoBars() {
  const slots = [
    { heights: [28, 46, 72, 88, 60, 38], label: "Slot 1" },
    { heights: [42, 65, 80, 70, 50, 30], label: "Slot 2" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {slots.map((slot, si) => (
        <div key={si}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
            {slot.label}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, alignItems: "end" }}>
            {slot.heights.map((h, i) => (
              <div key={i} style={{ height: h * 0.7, background: i === 3 ? "var(--accent)" : "var(--line-2)", borderRadius: 3 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Invalid credentials.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1.1fr 1fr",
      minHeight: "100vh",
      background: "var(--bg)",
      color: "var(--text)",
    }}>
      {/* Left pane */}
      <div style={{
        padding: "48px",
        background: "radial-gradient(900px 700px at 20% 60%, rgba(212,255,58,0.12), transparent 60%), var(--bg)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700,
            letterSpacing: "-0.01em", color: "#fff", lineHeight: 1, textTransform: "uppercase",
          }}>kenko</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#3A4540", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            powered by <span style={{ color: "#FF2D2D" }}>bounce</span>
          </div>
        </div>

        {/* Hero */}
        <div style={{ marginTop: "auto", marginBottom: "auto", display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: "var(--accent)",
            display: "inline-flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ width: 6, height: 6, background: "var(--accent)", borderRadius: 6 }} />
            operations console · v1.0
          </div>

          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: 64, lineHeight: 0.98, letterSpacing: "-0.03em",
            fontWeight: 700, margin: 0,
          }}>
            Deliver.<br />
            Track.<br />
            <span style={{ color: "var(--accent)" }}>Scale.</span>
          </h1>

          <p style={{ color: "var(--text-dim)", maxWidth: 440, fontSize: 15, lineHeight: 1.6 }}>
            Real-time visibility into every box that moves through a Bounce hub —
            inflow, in-transit, delivered, and everything that didn&apos;t go to plan.
          </p>

          {/* Stats */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 1, background: "var(--line)",
            border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden",
            marginTop: 8,
          }}>
            {[
              { num: "5", label: "Active hubs" },
              { num: "100/day", label: "Orders routed" },
              { num: "94.6%", label: "On-time rate" },
            ].map((s, i) => (
              <div key={i} style={{ background: "var(--bg)", padding: "16px 18px" }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, letterSpacing: "-0.02em" }}>
                  {s.num}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Deco bars */}
          <div style={{ marginTop: 8 }}>
            <DecoBars />
          </div>
        </div>

        <div style={{
          marginTop: "auto",
          fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--line-2)",
          letterSpacing: "0.1em", display: "flex", justifyContent: "space-between",
        }}>
          <span>BOUNCE × KENKO</span>
          <span>BENGALURU · 12.97°N, 77.59°E</span>
        </div>
      </div>

      {/* Right pane */}
      <div style={{
        padding: "48px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg)",
      }}>
        <form
          onSubmit={handleSubmit}
          style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 20 }}
        >
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Sign in
            </h2>
            <p style={{ color: "var(--text-mute)", fontSize: 13, marginTop: 8 }}>
              Use your Kenko work email to access the hub dashboard.
            </p>
          </div>

          {error && (
            <div style={{
              padding: "10px 12px",
              background: "rgba(212,255,58,0.08)",
              border: "1px solid rgba(212,255,58,0.3)",
              borderRadius: 6, color: "var(--accent)", fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-mute)" }}>
              Work email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="demo@kenko.com"
              autoComplete="email"
              style={{
                width: "100%", background: "#111",
                border: "1px solid var(--line)", borderRadius: 8,
                padding: "12px 14px", color: "var(--text)", fontSize: 14,
                fontFamily: "inherit", outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-mute)" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                width: "100%", background: "#111",
                border: "1px solid var(--line)", borderRadius: 8,
                padding: "12px 14px", color: "var(--text)", fontSize: 14,
                fontFamily: "inherit", outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--line)")}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "13px",
              borderRadius: 8, background: loading ? "var(--accent-dim)" : "var(--accent)",
              color: "var(--accent-ink)", fontWeight: 600, fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "background 120ms",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign in →"}
          </button>

          <p style={{ fontSize: 11, color: "var(--text-mute)", textAlign: "center", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
            Protected by Bounce SecOps · Session 4h
          </p>
        </form>
      </div>
    </div>
  );
}
