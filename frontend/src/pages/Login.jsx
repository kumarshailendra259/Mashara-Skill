import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  TrendingUp,
  Users,
  Fingerprint,
  Wallet,
  Building2,
  CheckCircle2,
  Quote,
} from "lucide-react";

const QUOTES = [
  {
    text: "Track every rupee. Empower every decision.",
    author: "Mashara Skills · Finance Tracker",
  },
  {
    text: "A budget tells your money where to go instead of wondering where it went.",
    author: "Dave Ramsey",
  },
  {
    text: "Discipline is the bridge between goals and accomplishment.",
    author: "Jim Rohn",
  },
  {
    text: "What gets measured, gets managed.",
    author: "Peter Drucker",
  },
];

const FEATURES = [
  { icon: Wallet, label: "Company & Project Investments" },
  { icon: Users, label: "HRMS · Payroll · Attendance" },
  { icon: Fingerprint, label: "Geo-fenced Check-in" },
  { icon: Building2, label: "Multi-Center RBAC Approvals" },
  { icon: TrendingUp, label: "Live P&L Dashboards" },
];

export default function Login() {
  const { login, user } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quoteIdx, setQuoteIdx] = useState(0);

  useEffect(() => {
    if (user) nav("/", { replace: true });
  }, [user, nav]);

  useEffect(() => {
    const id = setInterval(() => {
      setQuoteIdx((i) => (i + 1) % QUOTES.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.ok) {
      toast.success("Welcome");
      nav("/", { replace: true });
    } else toast.error(res.error);
  };

  const q = QUOTES[quoteIdx];

  return (
    <div
      className="min-h-screen w-full flex relative overflow-hidden"
      data-testid="login-page"
    >
      {/* =========================
          LEFT — Branding / Content
          ========================= */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 xl:p-16 text-white overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #0b1f4d 0%, #123a86 45%, #1e50c9 100%)",
        }}
        data-testid="login-hero"
      >
        {/* Decorative gradient blobs */}
        <div
          className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-blue-400/20 blur-3xl pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute -bottom-40 -right-32 w-[600px] h-[600px] rounded-full bg-indigo-500/25 blur-3xl pointer-events-none"
          aria-hidden
        />
        {/* Fine grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />
        {/* Corner accent */}
        <div
          className="absolute top-0 right-0 w-64 h-64 pointer-events-none opacity-40"
          style={{
            background:
              "radial-gradient(circle at top right, rgba(255,255,255,0.35), transparent 60%)",
          }}
          aria-hidden
        />

        {/* Brand */}
        <div className="relative flex items-center gap-3" data-testid="brand-block">
          <div className="h-12 w-12 flex items-center justify-center bg-white text-[#0b1f4d] font-heading font-black text-2xl shadow-xl">
            M
          </div>
          <div className="leading-tight">
            <div className="font-heading font-black text-lg tracking-tight">
              Mashara Skills
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/60">
              Finance & Ops Suite
            </div>
          </div>
        </div>

        {/* Middle — Headline + rotating quote */}
        <div className="relative max-w-lg">
          <div className="text-[11px] uppercase tracking-[0.28em] text-white/60 mb-4">
            Enterprise Finance & HR Platform
          </div>
          <h2 className="font-heading font-black text-3xl xl:text-4xl leading-[1.15] tracking-tight">
            One workspace to run
            <br />
            <span className="text-blue-300">every centre, every rupee.</span>
          </h2>

          {/* Rotating quote card */}
          <div
            key={quoteIdx}
            className="mt-8 relative bg-white/10 backdrop-blur-md border border-white/20 p-5 pl-6 animate-in fade-in slide-in-from-bottom-2 duration-500"
            data-testid="login-quote"
          >
            <Quote
              size={28}
              className="absolute -top-3 left-4 text-blue-300 bg-[#123a86] rounded-none p-1"
            />
            <p className="text-[15px] leading-relaxed font-medium text-white/95">
              “{q.text}”
            </p>
            <div className="mt-3 text-[11px] uppercase tracking-widest text-white/60">
              — {q.author}
            </div>

            {/* Dots */}
            <div className="mt-4 flex gap-1.5">
              {QUOTES.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 w-6 transition-all ${
                    i === quoteIdx ? "bg-blue-300" : "bg-white/25"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Features + footer */}
        <div className="relative">
          <div className="grid grid-cols-1 gap-2.5 mb-8" data-testid="feature-list">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-center gap-3 text-sm text-white/85">
                <div className="h-8 w-8 flex items-center justify-center bg-white/10 border border-white/15">
                  <f.icon size={15} className="text-blue-200" />
                </div>
                <span>{f.label}</span>
                <CheckCircle2 size={14} className="text-emerald-300 ml-auto" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] text-white/50 border-t border-white/10 pt-4">
            <span>© {new Date().getFullYear()} Mashara Skills</span>
            <span>Finance Tracker v1</span>
          </div>
        </div>
      </div>

      {/* =========================
          RIGHT — Login Form
          ========================= */}
      <div
        className="flex-1 flex items-center justify-center p-4 sm:p-8 relative"
        style={{
          background:
            "linear-gradient(180deg, #f7f9fc 0%, #eef2f9 100%)",
        }}
      >
        {/* Mobile-only decorative gradient stripe at top */}
        <div
          className="lg:hidden absolute top-0 left-0 right-0 h-40 pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, #0b1f4d 0%, #123a86 55%, #1e50c9 100%)",
          }}
          aria-hidden
        />

        <div className="relative w-full max-w-md">
          {/* Mobile brand header (hidden on desktop since left panel shows brand) */}
          <div className="lg:hidden text-center mb-6 relative z-10 pt-6">
            <div className="inline-flex items-center justify-center h-14 w-14 bg-white text-[#0b1f4d] font-heading font-black text-2xl shadow-xl">
              M
            </div>
            <div className="mt-2 text-white font-heading font-black text-lg tracking-tight">
              Mashara Skills
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/70">
              Finance & Ops Suite
            </div>
          </div>

          <div
            className="bg-white shadow-2xl border border-gray-100 rounded-none p-8 md:p-10"
            data-testid="login-card"
          >
            <div className="mb-7" data-testid="company-welcome">
              <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--brand)] font-bold mb-2">
                Sign in
              </div>
              <h1 className="font-heading font-black text-3xl md:text-[32px] tracking-tight text-[#0b1f4d] leading-[1.1]">
                {t("welcome") || "Welcome back"}
              </h1>
              <p className="text-sm text-[var(--muted)] mt-1.5">
                {t("sign_in_to_continue") ||
                  "Sign in to continue to your workspace"}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-5" data-testid="login-form">
              {/* Email */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]"
                >
                  {t("email") || "Email"}
                </Label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    data-testid="login-email"
                    className="rounded-none pl-9 h-11 border-gray-300 focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="pwd"
                    className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]"
                  >
                    {t("password") || "Password"}
                  </Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-[var(--brand)] hover:underline font-medium"
                    data-testid="link-forgot-password"
                  >
                    Forgot?
                  </Link>
                </div>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <Input
                    id="pwd"
                    type={showPwd ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    data-testid="login-password"
                    className="rounded-none pl-9 pr-10 h-11 border-gray-300 focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                    data-testid="toggle-password"
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={busy}
                className="w-full rounded-none h-11 font-bold tracking-wide text-white disabled:opacity-60 transition-transform active:scale-[0.99]"
                style={{
                  background:
                    "linear-gradient(90deg, #2E64C7 0%, #1E3A8A 100%)",
                }}
                data-testid="login-submit"
              >
                {busy ? "Signing in…" : t("login") || "Sign in"}
              </Button>

              {/* Trust badge */}
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)] pt-1">
                <ShieldCheck size={12} className="text-emerald-600" />
                <span>Secure encrypted connection · SSL protected</span>
              </div>

              {/* Register footer */}
              <div className="text-center text-sm text-[var(--muted)] pt-3 border-t border-gray-100 mt-3">
                New here?{" "}
                <Link
                  to="/register"
                  className="text-[var(--brand)] font-semibold hover:underline"
                  data-testid="link-register"
                >
                  {t("create_account") || "Create an account"}
                </Link>
              </div>
            </form>
          </div>

          {/* Copyright below card (mobile only, desktop shows in left) */}
          <div className="lg:hidden text-center text-[var(--muted)] text-[11px] mt-4">
            © {new Date().getFullYear()} Mashara Skills · Finance Tracker v1
          </div>
        </div>
      </div>
    </div>
  );
}
