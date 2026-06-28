import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
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
import { Pencil, Archive } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import BulkDeleteDialog from "@/components/BulkDeleteDialog";

const ROLES = ["admin", "manager", "senior_manager", "center_manager", "center_staff", "partner", "accountant", "hr", "reporting_authority", "center_partner", "viewer"];

export default function Users() {
  const { t } = useLang();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const [users, setUsers] = useState([]);
  const [centers, setCenters] = useState([]);
  const [partners, setPartners] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ role: "viewer", assigned_center_ids: [], assigned_partner_id: "" });
  // Preview of centers auto-derived for the picked partner (managed-from-User-Management UX)
  const [partnerCentersPreview, setPartnerCentersPreview] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Bulk archive state
  const [selected, setSelected] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = () => Promise.all([
    api.get("/auth/users"),
    api.get("/entities/center"),
    api.get("/entities/partner"),
  ]).then(([u, c, p]) => { setUsers(u.data); setCenters(c.data); setPartners(p.data); setSelected(new Set()); });

  useEffect(() => { load(); }, []);

  // Whenever the picked partner_id changes (and role==partner), fetch the centers this partner
  // is mapped to so admin can SEE exactly which centers the user will get visibility into.
  useEffect(() => {
    if (form.role !== "partner" || !form.assigned_partner_id) {
      setPartnerCentersPreview([]);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    api.get(`/partners/${form.assigned_partner_id}/centers`)
      .then((r) => { if (!cancelled) setPartnerCentersPreview(r.data?.centers || []); })
      .catch(() => { if (!cancelled) setPartnerCentersPreview([]); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [form.role, form.assigned_partner_id]);

  const archivableIds = users.filter((u) => u.id !== currentUser?.id).map((u) => u.id);
  const allSelected = archivableIds.length > 0 && archivableIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(archivableIds));
  };

  const bulkArchive = async () => {
    setBulkBusy(true);
    try {
      const res = await api.post("/auth/users/bulk-archive", { ids: Array.from(selected) });
      toast.success(`${res.data?.archived || 0} user(s) archived`);
      setBulkOpen(false);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };

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
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <Button onClick={() => setBulkOpen(true)} variant="outline" className="rounded-none gap-1 border-[var(--danger)] text-[var(--danger)] hover:bg-red-50" data-testid="bulk-archive-users">
              <Archive size={14} /> Archive ({selected.size})
            </Button>
          )}
          <PrintButton />
        </div>
      </div>
      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              {isAdmin && (
                <th className="p-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={archivableIds.length === 0} className="cursor-pointer" data-testid="select-all-users" />
                </th>
              )}
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
              <tr><td colSpan={isAdmin ? 7 : 6} className="text-center py-8 overline">{t("no_data")}</td></tr>
            ) : users.map((u) => {
              const centerNames = (u.assigned_center_ids || []).map((id) => centers.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
              const partnerName = partners.find((p) => p.id === u.assigned_partner_id)?.name || "—";
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} className={`border-b border-[var(--border)] hover:bg-gray-50 ${u.is_active === false ? "opacity-50" : ""}`}>
                  {isAdmin && (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => toggleOne(u.id)}
                        disabled={isSelf}
                        title={isSelf ? "Cannot archive yourself" : ""}
                        className="cursor-pointer disabled:opacity-30"
                        data-testid={`select-user-${u.id}`}
                      />
                    </td>
                  )}
                  <td className="p-3 font-medium">
                    {u.name}
                    {u.is_active === false && <span className="ml-2 text-xs text-[var(--muted)]">(archived)</span>}
                  </td>
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

      <BulkDeleteDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        count={selected.size}
        itemLabel="users"
        mode="archive"
        busy={bulkBusy}
        onConfirm={bulkArchive}
      />

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
                <SelectTrigger className="rounded-none" data-testid="user-partner-select"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.role === "partner" && form.assigned_partner_id && (
                <div className="mt-2 border border-[var(--border)] bg-blue-50/40 p-2" data-testid="partner-centers-preview">
                  <div className="overline text-[10px] mb-1">Centers this user will see (auto-derived)</div>
                  {previewLoading ? (
                    <div className="text-xs text-[var(--muted)]">Computing…</div>
                  ) : partnerCentersPreview.length === 0 ? (
                    <div className="text-xs text-amber-700">⚠ This partner is not currently mapped to any center (no batches/txns yet) — the user will see nothing until a batch is created.</div>
                  ) : (
                    <ul className="text-xs space-y-0.5 max-h-[120px] overflow-y-auto">
                      {partnerCentersPreview.map((c) => (
                        <li key={c.id} className="flex items-center gap-2">
                          <span className="inline-block w-1.5 h-1.5 bg-[var(--brand)]"></span>
                          <span className="font-medium">{c.name}</span>
                          {c.city && <span className="text-[var(--muted)]">· {c.city}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-[10px] text-[var(--muted)] mt-1">Mapping is derived from batches / center.partner_id / past transactions. Add more batches to grant access to more centers.</div>
                </div>
              )}
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
