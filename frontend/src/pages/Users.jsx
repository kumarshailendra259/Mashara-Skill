import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const ROLES = ["admin", "manager", "center_manager", "partner", "accountant", "viewer"];

export default function Users() {
  const { t } = useLang();
  const [users, setUsers] = useState([]);
  const [centers, setCenters] = useState([]);
  const [partners, setPartners] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ role: "viewer", assigned_center_ids: [], assigned_partner_id: "" });

  const load = () => Promise.all([
    api.get("/auth/users"),
    api.get("/entities/center"),
    api.get("/entities/partner"),
  ]).then(([u, c, p]) => { setUsers(u.data); setCenters(c.data); setPartners(p.data); });

  useEffect(() => { load(); }, []);

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      role: u.role,
      assigned_center_ids: u.assigned_center_ids || [],
      assigned_partner_id: u.assigned_partner_id || "",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      await api.patch(`/auth/users/${editing.id}`, {
        role: form.role,
        assigned_center_ids: form.assigned_center_ids,
        assigned_partner_id: form.assigned_partner_id || null,
      });
      setOpen(false); load(); toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  const toggleCenter = (id) => setForm((f) => ({
    ...f,
    assigned_center_ids: f.assigned_center_ids.includes(id)
      ? f.assigned_center_ids.filter((x) => x !== id)
      : [...f.assigned_center_ids, id],
  }));

  return (
    <div className="space-y-5" data-testid="users-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">{t("user_management")}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("user_management")}</h1>
        </div>
        <PrintButton />
      </div>
      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">{t("name")}</th>
              <th className="text-left p-3">{t("email")}</th>
              <th className="text-left p-3">{t("role")}</th>
              <th className="text-left p-3">{t("assign_centers")}</th>
              <th className="text-left p-3">{t("assign_partner")}</th>
              <th className="text-right p-3 w-24">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 overline">{t("no_data")}</td></tr>
            ) : users.map((u) => {
              const centerNames = (u.assigned_center_ids || []).map((id) => centers.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
              const partnerName = partners.find((p) => p.id === u.assigned_partner_id)?.name || "—";
              return (
                <tr key={u.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3">{u.email}</td>
                  <td className="p-3"><span className="inline-block px-2 py-0.5 text-xs border border-[var(--brand)] text-[var(--brand)]">{u.role}</span></td>
                  <td className="p-3 text-[var(--muted)]">{centerNames || "—"}</td>
                  <td className="p-3 text-[var(--muted)]">{partnerName}</td>
                  <td className="p-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(u)} className="rounded-none h-8 w-8" data-testid={`edit-user-${u.id}`}><Pencil size={14} /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">{editing?.name} — {editing?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("role")}</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger className="rounded-none" data-testid="user-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("assign_centers")}</Label>
              <div className="border border-[var(--border)] max-h-40 overflow-y-auto p-2 space-y-1">
                {centers.length === 0 ? <div className="overline">No centers yet</div> : centers.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.assigned_center_ids.includes(c.id)} onCheckedChange={() => toggleCenter(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>{t("assign_partner")}</Label>
              <Select value={form.assigned_partner_id || "__none"} onValueChange={(v) => setForm({ ...form, assigned_partner_id: v === "__none" ? "" : v })}>
                <SelectTrigger className="rounded-none"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">{t("cancel")}</Button>
            <Button onClick={save} className="brand-btn rounded-none" data-testid="user-save">{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
