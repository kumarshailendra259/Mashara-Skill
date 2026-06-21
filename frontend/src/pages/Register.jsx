import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function Register() {
  const { register } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "manager" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await register(form);
    setBusy(false);
    if (res.ok) { toast.success("Account created"); nav("/", { replace: true }); }
    else toast.error(res.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]" data-testid="register-page">
      <form onSubmit={submit} className="swiss-card p-8 w-full max-w-md space-y-5" data-testid="register-form">
        <div>
          <div className="overline">{t("register")}</div>
          <h2 className="font-heading font-black text-3xl tracking-tight mt-1">{t("create_account")}</h2>
        </div>
        <div className="space-y-2">
          <Label>{t("name")}</Label>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-none" data-testid="register-name" />
        </div>
        <div className="space-y-2">
          <Label>{t("email")}</Label>
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-none" data-testid="register-email" />
        </div>
        <div className="space-y-2">
          <Label>{t("password")}</Label>
          <Input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-none" data-testid="register-password" />
        </div>
        <div className="space-y-2">
          <Label>{t("role")}</Label>
          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
            <SelectTrigger className="rounded-none" data-testid="register-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={busy} className="w-full brand-btn rounded-none h-11" data-testid="register-submit">
          {busy ? "…" : t("create_account")}
        </Button>
        <div className="text-sm text-[var(--muted)]">
          Have an account? <Link to="/login" className="text-[var(--brand)] hover:underline" data-testid="link-login">{t("login")}</Link>
        </div>
      </form>
    </div>
  );
}
