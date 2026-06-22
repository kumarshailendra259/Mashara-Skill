import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Login() {
  const { login, user } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => { if (user) nav("/", { replace: true }); }, [user, nav]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await login(email, password);
    setBusy(false);
    if (res.ok) { toast.success("Welcome"); nav("/", { replace: true }); }
    else toast.error(res.error);
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2" data-testid="login-page">
      <div className="hidden md:flex flex-col justify-between p-12 bg-[#0a0a0a] text-white">
        <div className="overline text-white/60">// Console</div>
        <div>
          <h1 className="font-heading text-5xl font-black tracking-tight leading-[0.95]">
            Track every<br/>rupee.<br/><span className="text-[var(--brand)]" style={{color:"#7aa0ff"}}>By project.</span><br/>By partner.
          </h1>
          <p className="text-sm text-white/60 mt-6 max-w-sm">
            Company, partner, center & project wise investment, P&L, expense & income — in one console.
          </p>
        </div>
        <div className="text-xs text-white/40 overline">/finance/v1</div>
      </div>

      <div className="flex items-center justify-center p-8 bg-white">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div className="border-l-2 border-[var(--brand)] pl-3" data-testid="company-welcome">
            <div className="overline text-[var(--brand)]">Welcome to</div>
            <div className="font-heading font-bold text-lg tracking-tight leading-tight mt-0.5">Mashara Skills and Creative Learning Pvt Ltd</div>
          </div>
          <div>
            <div className="overline">{t("login")}</div>
            <h2 className="font-heading font-black text-3xl mt-1 tracking-tight">{t("welcome")}</h2>
            <p className="text-sm text-[var(--muted)] mt-1">{t("sign_in_to_continue")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" className="rounded-none" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pwd">{t("password")}</Label>
            <Input id="pwd" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" className="rounded-none" />
          </div>
          <Button type="submit" disabled={busy} className="w-full brand-btn rounded-none h-11 font-medium" data-testid="login-submit">
            {busy ? "…" : t("login")}
          </Button>
          <div className="text-sm text-[var(--muted)]">
            New here? <Link to="/register" className="text-[var(--brand)] hover:underline" data-testid="link-register">{t("create_account")}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
