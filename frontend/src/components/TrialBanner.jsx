import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Sparkles, Clock, Lock, CreditCard, Rocket } from "lucide-react";

/**
 * Global trial / lock banner. Driven entirely by scope.trial from the backend:
 *   - eligible  → offer the 10-day free trial (any role can start it)
 *   - active    → show days left + a subscribe CTA
 *   - expired   → everything is locked; prompt payment (anyone can pay)
 * Admins (global) never see it.
 */
export default function TrialBanner() {
  const { scope, startTrial } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  const trial = scope?.trial;
  const isAdmin = scope?.role === "admin";
  if (!trial || isAdmin) return null;

  const hasLocked = (scope?.blocked_modules || []).length > 0;

  const onStart = async () => {
    setBusy(true);
    const res = await startTrial();
    setBusy(false);
    if (res.ok) toast.success("🎉 10-day free trial started — all modules unlocked!");
    else toast.error(res.error || "Could not start trial");
  };

  // ELIGIBLE — never started a trial yet.
  if (trial.eligible) {
    return (
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 px-4 py-3"
        data-testid="trial-banner-eligible"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 flex items-center justify-center bg-indigo-600 text-white shrink-0"><Rocket size={18} /></div>
          <div>
            <div className="font-bold text-indigo-900 text-sm">Start your 10-day free trial</div>
            <div className="text-xs text-indigo-700/80">Unlock every module free for 10 days. No payment needed to try. Pay anytime to keep access.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={onStart} disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-60"
            data-testid="start-trial-btn"
          >
            <Sparkles size={14} /> {busy ? "Starting…" : "Start Free Trial"}
          </button>
          <button
            type="button" onClick={() => nav("/subscription")}
            className="inline-flex items-center gap-2 px-4 py-2 border border-indigo-300 text-indigo-800 text-sm font-medium hover:bg-white transition-colors"
            data-testid="trial-goto-pay"
          >
            <CreditCard size={14} /> Buy Now
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE trial — show remaining days.
  if (trial.active) {
    const urgent = trial.days_left <= 3;
    return (
      <div
        className={`mb-4 flex flex-wrap items-center justify-between gap-3 border px-4 py-3 ${urgent ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}
        data-testid="trial-banner-active"
      >
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 flex items-center justify-center text-white shrink-0 ${urgent ? "bg-amber-500" : "bg-emerald-600"}`}><Clock size={18} /></div>
          <div>
            <div className={`font-bold text-sm ${urgent ? "text-amber-900" : "text-emerald-900"}`}>
              Free trial active · {trial.days_left} day{trial.days_left === 1 ? "" : "s"} left
            </div>
            <div className={`text-xs ${urgent ? "text-amber-700/90" : "text-emerald-700/90"}`}>
              All modules are unlocked. Subscribe before the trial ends to avoid losing access.
            </div>
          </div>
        </div>
        <button
          type="button" onClick={() => nav("/subscription")}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors"
          data-testid="trial-active-pay"
        >
          <CreditCard size={14} /> Subscribe Now
        </button>
      </div>
    );
  }

  // EXPIRED trial (used) + still has locked modules → prompt payment.
  if (trial.used && hasLocked) {
    return (
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-3"
        data-testid="trial-banner-expired"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 flex items-center justify-center bg-rose-600 text-white shrink-0"><Lock size={18} /></div>
          <div>
            <div className="font-bold text-rose-900 text-sm">Your free trial has ended</div>
            <div className="text-xs text-rose-700/90">Modules are locked. Complete a payment to unlock and continue — any team member can pay.</div>
          </div>
        </div>
        <button
          type="button" onClick={() => nav("/subscription")}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors"
          data-testid="trial-expired-pay"
        >
          <CreditCard size={14} /> Pay to Unlock
        </button>
      </div>
    );
  }

  return null;
}
