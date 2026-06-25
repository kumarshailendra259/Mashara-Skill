import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Mail, KeyRound, Lock, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const nav = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.from || "/login";
  // step: 1=email, 2=otp, 3=new password, 4=done
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const requestOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/forgot-password", { email: email.trim() });
      toast.success(data?.message || "OTP sent if account exists");
      setStep(2);
    } catch (err) {
      toast.error(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      toast.error("OTP must be 6 digits");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/verify-otp", { email: email.trim(), otp });
      setResetToken(data.reset_token);
      toast.success("OTP verified. Set your new password.");
      setStep(3);
    } catch (err) {
      toast.error(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitNewPwd = async (e) => {
    e.preventDefault();
    if (newPwd.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { reset_token: resetToken, new_password: newPwd });
      setStep(4);
    } catch (err) {
      toast.error(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2" data-testid="forgot-password-page">
      <div className="hidden md:flex flex-col justify-between p-12 bg-[#0a0a0a] text-white">
        <div className="overline text-white/60">// Account recovery</div>
        <div>
          <h1 className="font-heading text-5xl font-black tracking-tight leading-[0.95]">
            Forgot your<br/>password?<br/>
            <span style={{ color: "#7aa0ff" }}>We&apos;ve got you.</span>
          </h1>
          <p className="text-sm text-white/60 mt-6 max-w-sm">
            A 6-digit OTP is delivered to your registered email. Valid for 15 minutes, single use.
          </p>
        </div>
        <div className="text-xs text-white/40 overline">/finance/v1</div>
      </div>

      <div className="flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm space-y-6">
          <Link to={returnTo} className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--brand)]" data-testid="back-to-login">
            <ArrowLeft size={12} /> Back to {returnTo === "/check-in" ? "staff app" : "login"}
          </Link>

          {/* Progress dots */}
          <div className="flex items-center gap-2 text-xs">
            {[1, 2, 3].map((n) => (
              <div key={n} className={`h-1 flex-1 ${step >= n ? "bg-[var(--brand)]" : "bg-gray-200"}`} />
            ))}
          </div>

          {step === 1 && (
            <form onSubmit={requestOtp} className="space-y-5" data-testid="step-email-form">
              <div>
                <div className="overline">Step 1 of 3</div>
                <h2 className="font-heading font-black text-3xl mt-1 tracking-tight">Enter your email</h2>
                <p className="text-sm text-[var(--muted)] mt-1">We&apos;ll send you a 6-digit OTP.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fp-email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={14} />
                  <Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="rounded-none pl-8" data-testid="fp-email-input" placeholder="you@company.com" />
                </div>
              </div>
              <Button type="submit" disabled={busy} className="w-full brand-btn rounded-none h-11 font-medium" data-testid="fp-send-otp-btn">
                {busy ? "Sending…" : "Send OTP"}
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={verifyOtp} className="space-y-5" data-testid="step-otp-form">
              <div>
                <div className="overline">Step 2 of 3</div>
                <h2 className="font-heading font-black text-3xl mt-1 tracking-tight">Enter the OTP</h2>
                <p className="text-sm text-[var(--muted)] mt-1">Sent to <strong>{email}</strong>. Valid for 15 minutes.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fp-otp">6-digit OTP</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={14} />
                  <Input
                    id="fp-otp"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="rounded-none pl-8 tracking-[0.4em] font-mono text-lg"
                    data-testid="fp-otp-input"
                    placeholder="000000"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={busy}
                  onClick={() => { setOtp(""); setStep(1); }}
                  className="rounded-none h-11" data-testid="fp-otp-back">
                  Change email
                </Button>
                <Button type="submit" disabled={busy || otp.length !== 6} className="flex-1 brand-btn rounded-none h-11 font-medium" data-testid="fp-verify-btn">
                  {busy ? "Verifying…" : "Verify OTP"}
                </Button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await api.post("/auth/forgot-password", { email: email.trim() }); toast.success("OTP re-sent"); }
                  catch (err) { toast.error(formatError(err)); }
                  finally { setBusy(false); }
                }}
                className="text-xs text-[var(--brand)] hover:underline"
                data-testid="fp-resend-otp"
              >
                Resend OTP
              </button>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={submitNewPwd} className="space-y-5" data-testid="step-newpwd-form">
              <div>
                <div className="overline">Step 3 of 3</div>
                <h2 className="font-heading font-black text-3xl mt-1 tracking-tight">Set a new password</h2>
                <p className="text-sm text-[var(--muted)] mt-1">At least 6 characters.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fp-pwd">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={14} />
                  <Input id="fp-pwd" type="password" required value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                    className="rounded-none pl-8" data-testid="fp-newpwd-input" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fp-pwd2">Confirm password</Label>
                <Input id="fp-pwd2" type="password" required value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                  className="rounded-none" data-testid="fp-confirmpwd-input" />
              </div>
              <Button type="submit" disabled={busy} className="w-full brand-btn rounded-none h-11 font-medium" data-testid="fp-reset-btn">
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}

          {step === 4 && (
            <div className="space-y-5 text-center" data-testid="step-done">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-green-50 text-[var(--success)] rounded-none mx-auto">
                <CheckCircle2 size={28} />
              </div>
              <div>
                <h2 className="font-heading font-black text-2xl tracking-tight">Password updated</h2>
                <p className="text-sm text-[var(--muted)] mt-1">You can now sign in with your new password.</p>
              </div>
              <Button onClick={() => nav(returnTo, { replace: true })} className="w-full brand-btn rounded-none h-11" data-testid="fp-go-login">
                {returnTo === "/check-in" ? "Open staff app" : "Go to login"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
