import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Trash2, Edit3, Eye, Landmark, Paperclip, ShieldCheck, AlertTriangle, Download,
} from "lucide-react";

const FIELDS = [
  { key: "letter_of_intent_no", label: "Letter of Intent (LoI) No" },
  { key: "work_order_no", label: "Work Order No" },
  { key: "in_favour_of", label: "In Favour Of" },
  { key: "applicant", label: "Applicant" },
  { key: "issued_by", label: "Issued By", required: true },
  { key: "bg_number", label: "Bank Guarantee Number", required: true },
  { key: "amount", label: "Amount", required: true, type: "number" },
  { key: "date_of_issuance", label: "Date of Issuance", required: true, type: "date" },
  { key: "valid_till", label: "Valid Till", required: true, type: "date" },
  { key: "bg_claim_expiry_date", label: "BG Claim Expiry Date", required: true, type: "date" },
];

const EMPTY = FIELDS.reduce((a, f) => ({ ...a, [f.key]: "" }), { center_id: "", location: "", remarks: "" });
const inr = (n) => Number(n || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export default function BankGuarantees() {
  const { user } = useAuth();
  const canWrite = ["admin", "hr", "manager", "senior_manager", "accountant"].includes(user?.role);
  const canDelete = ["admin", "hr"].includes(user?.role);

  const [rows, setRows] = useState([]);
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [centerFilter, setCenterFilter] = useState("all");
  const [showRenewed, setShowRenewed] = useState(false);

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const [viewing, setViewing] = useState(null);
  const [renewsBgId, setRenewsBgId] = useState("");
  const [runningAlerts, setRunningAlerts] = useState(false);
  const [chain, setChain] = useState(null);
  useEffect(() => {
    if (!viewing) { setChain(null); return; }
    // Only fetch the chain when the BG is either part of a renewal or has been renewed.
    if (viewing.renews_bg_id || viewing.renewed_by_bg_id) {
      api.get(`/bank-guarantees/${viewing.id}/chain`).then((r) => setChain(r.data)).catch(() => setChain(null));
    } else {
      setChain(null);
    }
  }, [viewing]);

  // Active BGs are candidates that can be renewed by a new BG. Pre-filter so
  // the dropdown only shows non-renewed / non-deleted BGs.
  const renewableBgs = useMemo(() => rows.filter((r) => !r.is_renewed && !r.is_deleted), [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (centerFilter !== "all") params.set("center_id", centerFilter);
      params.set("include_renewed", String(showRenewed));
      const { data } = await api.get(`/bank-guarantees?${params.toString()}`);
      setRows(data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [search, centerFilter, showRenewed]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => setCenters([]));
  }, []);
  const centerNameById = useMemo(() => {
    const m = new Map(); (centers || []).forEach((c) => m.set(c.id, c.name || c.id)); return m;
  }, [centers]);

  const openAdd = () => { setEditing({ ...EMPTY }); setFile(null); setRenewsBgId(""); setOpenForm(true); };
  const openEdit = (row) => { setEditing({ ...EMPTY, ...row }); setFile(null); setRenewsBgId(""); setOpenForm(true); };

  const save = async () => {
    const missing = FIELDS.filter((f) => f.required && !String(editing?.[f.key] || "").trim());
    if (missing.length) { toast.error(`Please fill: ${missing.map((f) => f.label).join(", ")}`); return; }
    if (!editing?.id && !file) { toast.error("Attachment is required"); return; }
    if (file && file.size > 2 * 1024 * 1024) { toast.error("Attachment must be less than 2MB"); return; }
    setSaving(true);
    try {
      const params = new URLSearchParams();
      FIELDS.forEach((f) => {
        const v = editing?.[f.key];
        if (v !== undefined && v !== null && v !== "") params.set(f.key, String(v));
      });
      if (editing?.center_id) params.set("center_id", editing.center_id);
      if (editing?.location) params.set("location", editing.location);
      if (editing?.remarks) params.set("remarks", editing.remarks);
      if (editing?.id) {
        // Edit — no file re-upload for now (keeping the module simple; users can delete + re-add if they need a new file).
        const body = { ...editing };
        delete body.id;
        await api.patch(`/bank-guarantees/${editing.id}`, body);
        toast.success("Bank guarantee updated");
      } else {
        if (renewsBgId) params.set("renews_bg_id", renewsBgId);
        const fd = new FormData(); if (file) fd.append("file", file);
        await api.post(`/bank-guarantees?${params.toString()}`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        toast.success(renewsBgId ? "New BG added — previous one marked Renewed." : "Bank guarantee added");
      }
      setOpenForm(false); setEditing(null); setFile(null); setRenewsBgId("");
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  const markRenewed = async (row) => {
    if (!window.confirm(`Mark BG "${row.bg_number}" as renewed? The expiry alert will stop showing.`)) return;
    try {
      await api.patch(`/bank-guarantees/${row.id}/renew`);
      toast.success("Marked as renewed");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete BG "${row.bg_number}"?`)) return;
    try {
      await api.delete(`/bank-guarantees/${row.id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const daysToExpiry = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="space-y-4" data-testid="bg-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">Finance · Guarantees</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1 flex items-center gap-3">
            <Landmark size={26} className="text-[var(--brand)]" /> Bank Guarantee Tracking
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">Attach BG PDFs, track claim expiry, and get a dashboard alert 30 days before expiry.</div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {user?.role === "admin" && (
              <Button variant="outline" onClick={async () => {
                setRunningAlerts(true);
                try {
                  const { data } = await api.post("/bank-guarantees/run-alerts?force=true");
                  toast.success(`Alerts sent to ${data.recipients?.length || 0} recipient(s) for ${data.sent} BG(s)`);
                } catch (e) { toast.error(formatError(e)); }
                finally { setRunningAlerts(false); }
              }} disabled={runningAlerts} className="rounded-none gap-2 text-red-700 border-red-400" data-testid="btn-run-alerts" title="Manually send Day-30/15/7/0 email alerts">
                <AlertTriangle size={14} /> {runningAlerts ? "Sending…" : "Send Alerts Now"}
              </Button>
            )}
            <Button onClick={openAdd} className="brand-btn rounded-none gap-2" data-testid="btn-add-bg"><Plus size={16} /> Add Bank Guarantee</Button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="swiss-card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <Label className="overline">Search</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="BG number / LoI / WO / Bank / Location" className="rounded-none pl-7" data-testid="bg-search" />
          </div>
        </div>
        <div>
          <Label className="overline">Center</Label>
          <Select value={centerFilter} onValueChange={setCenterFilter}>
            <SelectTrigger className="rounded-none" data-testid="bg-center-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Centers</SelectItem>
              {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <label className="text-xs flex items-center gap-2 text-[var(--muted)]">
            <input type="checkbox" checked={showRenewed} onChange={(e) => setShowRenewed(e.target.checked)} data-testid="bg-show-renewed" />
            Show renewed
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-[var(--border)] overline">
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">BG Number</th>
              <th className="text-left p-3">Issued By</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">In Favour Of</th>
              <th className="text-left p-3">Center · Location</th>
              <th className="text-left p-3">Issued</th>
              <th className="text-left p-3">Valid Till</th>
              <th className="text-left p-3">Claim Expiry</th>
              <th className="text-right p-3 no-print">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-8 text-xs text-[var(--muted)]">{loading ? "Loading…" : "No bank guarantees yet."}</td></tr>
            ) : rows.map((r) => {
              const d = daysToExpiry(r.bg_claim_expiry_date);
              const isExpired = d !== null && d < 0;
              const isSoon = d !== null && d >= 0 && d <= 30;
              const chip = r.is_renewed
                ? { c: "bg-gray-100 text-gray-600", t: "Renewed" }
                : isExpired ? { c: "bg-red-600 text-white", t: "EXPIRED" }
                : isSoon ? { c: "bg-red-100 text-red-800 border border-red-400 font-bold", t: `${d}d left` }
                : { c: "bg-emerald-50 text-emerald-700 border border-emerald-200", t: "Active" };
              return (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-gray-50" data-testid={`bg-row-${r.id}`}>
                  <td className="p-3"><span className={`px-2 py-0.5 text-[10px] uppercase ${chip.c}`}>{chip.t}</span></td>
                  <td className="p-3 font-mono text-xs">{r.bg_number}</td>
                  <td className="p-3">{r.issued_by}</td>
                  <td className="p-3 text-right num">{inr(r.amount)}</td>
                  <td className="p-3">{r.in_favour_of || "—"}</td>
                  <td className="p-3">{r.center_id ? (centerNameById.get(r.center_id) || r.center_id) : "—"}{r.location ? <span className="text-[var(--muted)]"> · {r.location}</span> : ""}</td>
                  <td className="p-3 num">{r.date_of_issuance || "—"}</td>
                  <td className="p-3 num">{r.valid_till || "—"}</td>
                  <td className={`p-3 num ${(isSoon || isExpired) && !r.is_renewed ? "text-red-700 font-bold" : ""}`}>{r.bg_claim_expiry_date || "—"}</td>
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-0.5 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => setViewing(r)} className="h-7 w-7 rounded-none" title="View" data-testid={`bg-view-${r.id}`}><Eye size={13} /></Button>
                      {canWrite && !r.is_renewed && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} className="h-7 w-7 rounded-none" title="Edit" data-testid={`bg-edit-${r.id}`}><Edit3 size={13} /></Button>
                      )}
                      {canWrite && !r.is_renewed && (isSoon || isExpired) && (
                        <Button size="icon" variant="ghost" onClick={() => markRenewed(r)} className="h-7 w-7 rounded-none text-emerald-700" title="Mark renewed" data-testid={`bg-renew-${r.id}`}><ShieldCheck size={13} /></Button>
                      )}
                      {canDelete && (
                        <Button size="icon" variant="ghost" onClick={() => remove(r)} className="h-7 w-7 rounded-none hover:text-[var(--danger)]" title="Delete" data-testid={`bg-del-${r.id}`}><Trash2 size={13} /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={openForm} onOpenChange={(o) => { if (!o) { setOpenForm(false); setEditing(null); setFile(null); } }}>
        <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="bg-form">
          <DialogHeader><DialogTitle className="font-heading">{editing?.id ? "Edit" : "Add"} Bank Guarantee</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Renewal chain — only shown when creating a new BG. Picking one
                  auto-flips the referenced BG to Renewed on submit and stitches
                  the audit trail. */}
              {!editing.id && renewableBgs.length > 0 && (
                <div className="md:col-span-2 border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
                  <Label className="overline text-emerald-800">Renews BG (optional)</Label>
                  <Select value={renewsBgId || ""} onValueChange={(v) => setRenewsBgId(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="rounded-none" data-testid="bg-field-renews_bg_id">
                      <SelectValue placeholder="Not a renewal — leave empty" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not a renewal —</SelectItem>
                      {renewableBgs.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.bg_number} · {b.issued_by} · expires {b.bg_claim_expiry_date}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-[10px] text-emerald-800 mt-1">Selected BG will auto-mark as <b>Renewed</b> and get linked as its successor.</div>
                </div>
              )}
              {FIELDS.map((f) => (
                <div key={f.key} className={f.key === "letter_of_intent_no" ? "md:col-span-2" : ""}>
                  <Label className="overline">{f.label}{f.required && <span className="text-[var(--danger)]">*</span>}</Label>
                  <Input
                    type={f.type || "text"}
                    value={editing[f.key] || ""}
                    onChange={(e) => setEditing((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="rounded-none"
                    data-testid={`bg-field-${f.key}`}
                  />
                </div>
              ))}
              <div>
                <Label className="overline">Center</Label>
                <Select value={editing.center_id || ""} onValueChange={(v) => setEditing((s) => ({ ...s, center_id: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="rounded-none" data-testid="bg-field-center_id"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="overline">Location</Label>
                <Input value={editing.location || ""} onChange={(e) => setEditing((s) => ({ ...s, location: e.target.value }))} className="rounded-none" data-testid="bg-field-location" />
              </div>
              <div className="md:col-span-2">
                <Label className="overline">Remarks</Label>
                <Textarea value={editing.remarks || ""} onChange={(e) => setEditing((s) => ({ ...s, remarks: e.target.value }))} className="rounded-none" rows={2} data-testid="bg-field-remarks" />
              </div>
              {!editing.id && (
                <div className="md:col-span-2">
                  <Label className="overline">Attachment <span className="text-[var(--danger)]">*</span> <span className="text-[10px] text-[var(--muted)]">(must be &lt; 2MB, PDF/JPG/PNG)</span></Label>
                  <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm mt-1" data-testid="bg-field-file" />
                  {file && <div className="text-xs text-[var(--brand)] mt-1">{file.name} · {(file.size / 1024).toFixed(0)} KB</div>}
                </div>
              )}
              {editing.id && editing.attachment?.filename && (
                <div className="md:col-span-2 text-xs text-[var(--muted)]">
                  <Paperclip size={12} className="inline mr-1" /> Attached: {editing.attachment.filename}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenForm(false); setEditing(null); setFile(null); }} className="rounded-none">Cancel</Button>
            <Button onClick={save} disabled={saving} className="brand-btn rounded-none" data-testid="bg-save">{saving ? "Saving…" : (editing?.id ? "Save changes" : "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="rounded-none max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="bg-view">
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="font-heading">BG {viewing.bg_number}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {[
                  ...FIELDS,
                  { key: "center_id", label: "Center" },
                  { key: "location", label: "Location" },
                  { key: "remarks", label: "Remarks" },
                ].map((f) => (
                  <div key={f.key}>
                    <div className="overline text-[10px]">{f.label}</div>
                    <div className="mt-0.5">
                      {f.key === "amount" ? inr(viewing.amount)
                        : f.key === "center_id" ? (viewing.center_id ? (centerNameById.get(viewing.center_id) || viewing.center_id) : "—")
                        : (viewing[f.key] || "—")}
                    </div>
                  </div>
                ))}
                {viewing.attachment?.path && (
                  <div className="md:col-span-2">
                    <div className="overline text-[10px]">Attachment</div>
                    <a
                      href={`${process.env.REACT_APP_BACKEND_URL}/api/files/view?path=${encodeURIComponent(viewing.attachment.path)}`}
                      target="_blank" rel="noreferrer"
                      className="text-[var(--brand)] hover:underline text-sm inline-flex items-center gap-1 mt-1"
                      data-testid="bg-attach-download"
                    >
                      <Download size={12} /> {viewing.attachment.filename}
                    </a>
                  </div>
                )}
                {chain && chain.chain?.length > 1 && (
                  <div className="md:col-span-2 border-t border-[var(--border)] pt-3" data-testid="bg-chain">
                    <div className="overline text-[10px] mb-2">Renewal Audit Chain ({chain.count})</div>
                    <ol className="space-y-1 text-xs">
                      {chain.chain.map((b, i) => {
                        const isCurrent = b.id === viewing.id;
                        const isLast = i === chain.chain.length - 1;
                        return (
                          <li key={b.id} className="flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center h-5 w-5 text-[10px] font-bold ${isCurrent ? "bg-[var(--brand)] text-white" : "bg-gray-200 text-[var(--muted)]"}`}>{i + 1}</span>
                            <span className={`font-mono ${isCurrent ? "font-bold text-[var(--brand)]" : ""}`}>{b.bg_number}</span>
                            <span className="text-[var(--muted)]">· {b.issued_by} · exp {b.bg_claim_expiry_date}</span>
                            {b.is_renewed && <span className="ml-1 text-[10px] uppercase text-emerald-700">Renewed</span>}
                            {isCurrent && <span className="ml-1 text-[10px] uppercase text-[var(--brand)]">Current</span>}
                            {!isLast && <span className="text-[var(--muted)]">→</span>}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -----------------------------------------------------------------
   Dashboard alert — imported by the Dashboard page. Shows a big red
   bold banner while any active BG's claim expiry is within 30 days
   or already expired. Disappears when every such BG is marked renewed.
   ----------------------------------------------------------------- */
export function BGExpiryAlert() {
  const [data, setData] = useState({ expiring: [], expired: [] });
  useEffect(() => {
    api.get("/bank-guarantees/expiring-soon?days=30")
      .then((r) => setData(r.data || { expiring: [], expired: [] }))
      .catch(() => {});
  }, []);
  const total = (data.expiring?.length || 0) + (data.expired?.length || 0);
  if (!total) return null;
  return (
    <div className="border-2 border-red-600 bg-red-50 p-4 shadow-lg animate-pulse" data-testid="bg-expiry-alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={28} />
        <div className="flex-1">
          <div className="text-red-700 font-heading font-black text-lg uppercase tracking-wide">
            Bank Guarantee Expiry Alert
          </div>
          <div className="text-red-800 font-bold text-sm mt-1">
            {data.expired.length > 0 && <div>⚠️ {data.expired.length} BG{data.expired.length > 1 ? "s have" : " has"} already <b>EXPIRED</b>.</div>}
            {data.expiring.length > 0 && <div>⏳ {data.expiring.length} BG{data.expiring.length > 1 ? "s expire" : " expires"} within the next 30 days.</div>}
          </div>
          <ul className="mt-2 text-xs text-red-900 space-y-1">
            {[...data.expired, ...data.expiring].slice(0, 6).map((bg) => (
              <li key={bg.id} className="border-l-4 border-red-500 pl-2">
                <span className="font-mono font-bold">{bg.bg_number}</span>
                {" — "}
                <span>{bg.issued_by}</span>
                {" · "}
                <span className="font-bold">expires {bg.bg_claim_expiry_date}</span>
                {bg.in_favour_of ? <span> · in favour of {bg.in_favour_of}</span> : null}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <a href="/bank-guarantees" className="brand-btn rounded-none px-3 py-1 text-xs inline-block" data-testid="bg-alert-cta">
              Open Bank Guarantee Tracking →
            </a>
            <span className="text-[10px] text-red-700 ml-3 italic">Alert stays until each BG is marked as renewed.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
