import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, Copy, Mail, KeyRound, Check } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import BulkDeleteDialog from "@/components/BulkDeleteDialog";

// Empty-form templates per entity type — only the relevant fields surface in the dialog.
const EMPTY_FORM = {
  company: {
    name: "", description: "", email: "", mobile: "",
    gst_number: "", pan_number: "", cin_number: "", registration_number: "",
    address: "", city: "", state: "", pincode: "",
  },
  partner: {
    name: "", description: "", email: "", mobile: "",
    pan_number: "", gst_number: "", address: "", city: "", state: "", pincode: "",
  },
  center: {
    name: "", description: "", manager_name: "", email: "", mobile: "",
    address: "", city: "", state: "", pincode: "",
  },
  project: {
    name: "", description: "", project_type: "", project_code: "",
    funding_agency: "", start_date: "", end_date: "",
  },
};

export default function Entities({ etype }) {
  const { t } = useLang();
  const { user } = useAuth();
  const canEdit = ["admin", "manager"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const [items, setItems] = useState([]);
  const [projectTypes, setProjectTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM[etype] || EMPTY_FORM.company);
  const [selected, setSelected] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Reveal password modal after auto-user creation
  const [credModal, setCredModal] = useState(null);  // { email, password, entityName }
  const [copied, setCopied] = useState(false);

  const load = () =>
    api.get(`/entities/${etype}`).then((r) => { setItems(r.data); setSelected(new Set()); });

  useEffect(() => { load(); }, [etype]);

  // Project types only needed on Projects page
  useEffect(() => {
    if (etype === "project") {
      api.get("/project-types").then((r) => setProjectTypes(r.data || [])).catch(() => {});
    }
  }, [etype]);

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM[etype]); setOpen(true); };
  const openEdit = (it) => {
    setEditing(it);
    // Pick only fields relevant to this etype + spread known to avoid stale data
    const base = EMPTY_FORM[etype];
    const next = { ...base };
    Object.keys(base).forEach((k) => { if (it[k] !== undefined && it[k] !== null) next[k] = it[k]; });
    setForm(next);
    setOpen(true);
  };

  const save = async () => {
    try {
      if (!form.name?.trim()) { toast.error("Name is required"); return; }
      // Clean empties so backend doesn't store ""
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "" && v !== null));
      const res = editing
        ? await api.put(`/entities/${etype}/${editing.id}`, payload)
        : await api.post(`/entities/${etype}`, payload);
      setOpen(false);
      load();
      toast.success("Saved");
      if (res.data?.generated_password) {
        setCredModal({
          email: res.data.email, password: res.data.generated_password,
          entityName: res.data.name, role: etype === "center" ? "Center Manager" : "Partner",
        });
        setCopied(false);
      }
    } catch (e) { toast.error(formatError(e)); }
  };

  const remove = async (it) => {
    if (!window.confirm(t("confirm_delete"))) return;
    try { await api.delete(`/entities/${etype}/${it.id}`); load(); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); }
  };

  const allIds = items.map((i) => i.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));

  const bulkDelete = async () => {
    setBulkBusy(true);
    try {
      const res = await api.post(`/entities/${etype}/bulk-delete`, { ids: Array.from(selected) });
      toast.success(`${res.data?.deleted || 0} deleted`);
      setBulkOpen(false);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };

  const copyCreds = () => {
    if (!credModal) return;
    const text = `Email: ${credModal.email}\nPassword: ${credModal.password}\nLogin URL: https://finance.masharaskills.com/login`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      toast.success("Credentials copied");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const titleKey = etype + "s";
  const extraColumns = useMemo(() => {
    if (etype === "company") return [{ key: "gst_number", label: "GST" }, { key: "email", label: "Email" }];
    if (etype === "partner") return [{ key: "email", label: "Email" }, { key: "mobile", label: "Mobile" }, { key: "_mail_status", label: "Login Mail" }];
    if (etype === "center")  return [{ key: "manager_name", label: "Manager" }, { key: "email", label: "Email" }, { key: "_mail_status", label: "Login Mail" }];
    if (etype === "project") return [{ key: "project_type", label: "Type" }, { key: "project_code", label: "Code" }];
    return [];
  }, [etype]);

  const resendCredentials = async (it) => {
    if (!window.confirm(`Resend login credentials to ${it.email}?\nA NEW temporary password will be generated.`)) return;
    try {
      const r = await api.post(`/entities/${etype}/${it.id}/resend-credentials`);
      load();
      if (r.data?.generated_password) {
        setCredModal({
          email: r.data.email || it.email, password: r.data.generated_password,
          entityName: it.name, role: etype === "center" ? "Center Manager" : "Partner",
        });
        setCopied(false);
      }
      if (r.data?.sent) toast.success(`Email sent to ${it.email}`);
      else toast.error(`Email failed: ${r.data?.reason || "unknown"}. Password shown — copy manually.`);
    } catch (e) { toast.error(formatError(e)); }
  };

  const renderCell = (it, key) => {
    if (key === "_mail_status") {
      if (!it.email) return <span className="text-[var(--muted)]">—</span>;
      if (it.credentials_mail_sent) {
        return (
          <span className="inline-flex items-center gap-1 text-[var(--success)]">
            <Check size={14} />
            <span className="overline text-[10px]">Sent {it.credentials_mail_at ? new Date(it.credentials_mail_at).toLocaleDateString("en-IN") : ""}</span>
          </span>
        );
      }
      if (it.credentials_mail_error) {
        return (
          <span className="inline-flex items-center gap-1 text-[var(--danger)]" title={it.credentials_mail_error}>
            <span className="overline text-[10px]">⚠ Failed</span>
          </span>
        );
      }
      return <span className="overline text-[10px] text-[var(--muted)]">Not sent</span>;
    }
    return <span className="text-[var(--muted)]">{it[key] || "—"}</span>;
  };

  const renderForm = () => (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Label>Name <span className="text-[var(--danger)]">*</span></Label>
        <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-none" data-testid="entity-name" />
      </div>

      {/* COMPANY-only fields */}
      {etype === "company" && <>
        <div><Label>GST Number</Label><Input value={form.gst_number || ""} onChange={(e) => setForm({ ...form, gst_number: e.target.value.toUpperCase() })} className="rounded-none num" data-testid="entity-gst" /></div>
        <div><Label>PAN Number</Label><Input value={form.pan_number || ""} onChange={(e) => setForm({ ...form, pan_number: e.target.value.toUpperCase() })} className="rounded-none num" data-testid="entity-pan" /></div>
        <div><Label>CIN Number</Label><Input value={form.cin_number || ""} onChange={(e) => setForm({ ...form, cin_number: e.target.value.toUpperCase() })} className="rounded-none num" data-testid="entity-cin" /></div>
        <div><Label>Registration Number</Label><Input value={form.registration_number || ""} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} className="rounded-none" data-testid="entity-reg-no" /></div>
        <div><Label>Email</Label><Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-none" /></div>
        <div><Label>Phone</Label><Input value={form.mobile || ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="rounded-none num" /></div>
      </>}

      {/* PARTNER fields — email creates login automatically */}
      {etype === "partner" && <>
        <div className="col-span-2">
          <Label>Email <span className="overline text-[10px] text-[var(--muted)]">(becomes login ID for this partner — auto-generated password sent via email)</span></Label>
          <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-none" data-testid="entity-email" />
        </div>
        <div><Label>Mobile</Label><Input value={form.mobile || ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="rounded-none num" /></div>
        <div><Label>PAN</Label><Input value={form.pan_number || ""} onChange={(e) => setForm({ ...form, pan_number: e.target.value.toUpperCase() })} className="rounded-none num" /></div>
      </>}

      {/* CENTER fields — manager email creates login */}
      {etype === "center" && <>
        <div><Label>Center Manager Name</Label><Input value={form.manager_name || ""} onChange={(e) => setForm({ ...form, manager_name: e.target.value })} className="rounded-none" data-testid="entity-manager-name" /></div>
        <div><Label>Mobile</Label><Input value={form.mobile || ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="rounded-none num" /></div>
        <div className="col-span-2">
          <Label>Email <span className="overline text-[10px] text-[var(--muted)]">(becomes Center Manager&apos;s login ID — auto-generated password emailed)</span></Label>
          <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-none" data-testid="entity-email" />
        </div>
      </>}

      {/* PROJECT fields */}
      {etype === "project" && <>
        <div>
          <Label>Project Type</Label>
          <Select value={form.project_type || "__none"} onValueChange={(v) => setForm({ ...form, project_type: v === "__none" ? "" : v })}>
            <SelectTrigger className="rounded-none" data-testid="entity-project-type"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— None —</SelectItem>
              {projectTypes.filter((p) => p.active !== false).map((p) => (
                <SelectItem key={p.id} value={p.code}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[10px] text-[var(--muted)] mt-1">Manage list via Settings → Project Types</div>
        </div>
        <div><Label>Project Code</Label><Input value={form.project_code || ""} onChange={(e) => setForm({ ...form, project_code: e.target.value })} className="rounded-none num" /></div>
        <div><Label>Funding Agency</Label><Input value={form.funding_agency || ""} onChange={(e) => setForm({ ...form, funding_agency: e.target.value })} className="rounded-none" /></div>
        <div className="grid grid-cols-2 gap-2 col-span-1">
          <div><Label>Start</Label><Input type="date" value={form.start_date || ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="rounded-none num" /></div>
          <div><Label>End</Label><Input type="date" value={form.end_date || ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="rounded-none num" /></div>
        </div>
      </>}

      {/* Address — shared by company / partner / center */}
      {etype !== "project" && <>
        <div className="col-span-2"><Label>Address</Label><Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-none" /></div>
        <div><Label>City</Label><Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} className="rounded-none" /></div>
        <div><Label>State</Label><Input value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} className="rounded-none" /></div>
        <div><Label>Pincode</Label><Input value={form.pincode || ""} onChange={(e) => setForm({ ...form, pincode: e.target.value })} className="rounded-none num" /></div>
      </>}

      <div className="col-span-2">
        <Label>Description</Label>
        <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-none" rows={2} />
      </div>
    </div>
  );

  return (
    <div className="space-y-5" data-testid={`entities-${etype}-page`}>
      <div className="flex justify-between items-end gap-3">
        <div>
          <div className="overline">{t("entities") || t(titleKey)}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t(titleKey)}</h1>
        </div>
        <div className="flex gap-2">
          {canDelete && selected.size > 0 && (
            <Button onClick={() => setBulkOpen(true)} variant="outline" className="rounded-none gap-1 border-[var(--danger)] text-[var(--danger)] hover:bg-red-50" data-testid={`bulk-delete-${etype}`}>
              <Trash2 size={14} /> Delete ({selected.size})
            </Button>
          )}
          <PrintButton />
          {canEdit && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="brand-btn rounded-none gap-2" data-testid={`btn-new-${etype}`}>
                  <Plus size={16} /> {t("add")}
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-none max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-heading tracking-tight">
                    {editing ? t("edit") : t("add")} — {t(etype)}
                  </DialogTitle>
                </DialogHeader>
                {renderForm()}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">{t("cancel")}</Button>
                  <Button onClick={save} className="brand-btn rounded-none" data-testid="entity-save">{t("save")}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              {canDelete && (
                <th className="p-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={allIds.length === 0} className="cursor-pointer" data-testid={`select-all-${etype}`} />
                </th>
              )}
              <th className="text-left p-3">{t("name")}</th>
              {extraColumns.map((c) => <th key={c.key} className="text-left p-3">{c.label}</th>)}
              <th className="text-left p-3">{t("description")}</th>
              {canEdit && <th className="p-3 w-28 text-right">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={extraColumns.length + (canDelete ? 4 : 3)} className="text-center py-8 overline">{t("no_data")}</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                {canDelete && (
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleOne(it.id)} className="cursor-pointer" data-testid={`select-${etype}-${it.id}`} />
                  </td>
                )}
                <td className="p-3 font-medium">{it.name}</td>
                {extraColumns.map((c) => (
                  <td key={c.key} className="p-3 num">{renderCell(it, c.key)}</td>
                ))}
                <td className="p-3 text-[var(--muted)] max-w-xs truncate">{it.description || "—"}</td>
                {canEdit && (
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      {(etype === "center" || etype === "partner") && it.email && (
                        <Button size="icon" variant="ghost" onClick={() => resendCredentials(it)} className="rounded-none h-8 w-8" title="Re-send login credentials (new password)" data-testid={`resend-${it.id}`}>
                          <Mail size={14} />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => openEdit(it)} className="rounded-none h-8 w-8" data-testid={`edit-${it.id}`}><Pencil size={14} /></Button>
                      {canDelete && <Button size="icon" variant="ghost" onClick={() => remove(it)} className="rounded-none h-8 w-8 hover:text-[var(--danger)]" data-testid={`delete-${it.id}`}><Trash2 size={14} /></Button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BulkDeleteDialog open={bulkOpen} onClose={() => setBulkOpen(false)} count={selected.size} itemLabel={titleKey} busy={bulkBusy} onConfirm={bulkDelete}
        warning="Related transactions referencing these entities will become orphaned." />

      {/* Auto-created credentials reveal modal */}
      <Dialog open={!!credModal} onOpenChange={(v) => !v && setCredModal(null)}>
        <DialogContent className="rounded-none max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <KeyRound size={18} className="text-[var(--brand)]" /> Login Credentials Created
            </DialogTitle>
          </DialogHeader>
          {credModal && (
            <div className="space-y-3">
              <div className="border-l-2 border-[var(--brand)] bg-blue-50 p-3 text-sm">
                <div className="overline text-[10px]">{credModal.role} Account For</div>
                <div className="font-bold text-base">{credModal.entityName}</div>
              </div>
              <div className="border border-[var(--border)] bg-gray-50 p-3 space-y-2">
                <div>
                  <div className="overline text-[10px]">Email</div>
                  <div className="num font-medium select-all">{credModal.email}</div>
                </div>
                <div>
                  <div className="overline text-[10px]">Temporary Password</div>
                  <div className="num font-bold text-lg select-all" data-testid="generated-password">{credModal.password}</div>
                </div>
              </div>
              <div className="border-l-2 border-[var(--warning)] bg-yellow-50 p-2 text-xs">
                <Mail size={12} className="inline mr-1" />
                Credentials emailed via Resend. <strong>Save this password</strong> — it won&apos;t be shown again. User should change it after first login.
              </div>
              <Button onClick={copyCreds} className="w-full brand-btn rounded-none gap-1" data-testid="copy-credentials">
                {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Email + Password</>}
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredModal(null)} variant="outline" className="rounded-none">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
