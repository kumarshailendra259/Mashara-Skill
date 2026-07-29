import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, Pencil, GitMerge, Power } from "lucide-react";
import PrintButton from "@/components/PrintButton";

const TYPES = [
  { v: "reimbursement", label: "Reimbursement" },
  { v: "leave", label: "Leave" },
  { v: "transaction", label: "Transaction" },
  { v: "asset_purchase", label: "Asset Purchase" },
  { v: "employee_transfer", label: "Employee Transfer" },
  { v: "regularisation", label: "Regularisation" },
  { v: "quotation", label: "Quotation Request" },
  { v: "payment", label: "Payment Request (against QRN)" },
  { v: "advance_request", label: "Advance Request" },
];

const KINDS = [
  { v: "reports_to", label: "Reports-To (dynamic)", help: "Resolves to submitter's manager at the given depth" },
  { v: "role", label: "Role", help: "Anyone with this role can approve" },
  { v: "staff", label: "Specific Staff", help: "Pick a staff member by name (uses their linked login)" },
  { v: "user", label: "Specific User", help: "Direct user ID" },
];

const ROLE_OPTIONS = ["admin", "manager", "senior_manager", "center_manager", "hr", "accountant", "partner", "center_staff", "viewer"];

const emptyStep = () => ({ level: 1, kind: "reports_to", value: "1", label: "", optional: false });

const CENTER_NONE = "__global__";  // sentinel for "applies to all centers (default)"

export default function ApprovalWorkflows() {
  const { user } = useAuth();
  const canEdit = ["admin", "hr"].includes(user?.role);

  const [chains, setChains] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [centersList, setCentersList] = useState([]);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: "", type: "reimbursement", center_ids: [], steps: [emptyStep()], active: true });

  const load = async () => {
    try {
      const [c, s, u, ct] = await Promise.all([
        api.get("/approval-chains"),
        api.get("/staff"),
        canEdit ? api.get("/auth/users") : Promise.resolve({ data: [] }),
        api.get("/entities/center"),
      ]);
      setChains(c.data || []);
      setStaffList(s.data || []);
      setUsersList(u.data || []);
      setCentersList(ct.data || []);
    } catch (e) { toast.error(formatError(e)); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", type: "reimbursement", center_ids: [], steps: [emptyStep()], active: true });
    setOpen(true);
  };

  const openEdit = (c) => {
    setEditingId(c.id);
    // Legacy single-center chains carry `center_id`; merge into `center_ids` for the UI.
    const mergedIds = Array.isArray(c.center_ids) && c.center_ids.length > 0
      ? c.center_ids
      : (c.center_id ? [c.center_id] : []);
    setForm({
      name: c.name,
      type: c.type,
      center_ids: mergedIds,
      active: !!c.active,
      steps: (c.steps || []).map((s) => ({ ...s })),
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      if (!form.name.trim()) { toast.error("Name is required"); return; }
      if (!form.steps.length) { toast.error("Add at least one step"); return; }
      const payload = {
        name: form.name,
        type: form.type,
        active: !!form.active,
        center_ids: form.center_ids || [],
        steps: form.steps.map((s, i) => ({
          level: i + 1,
          kind: s.kind,
          value: String(s.value || ""),
          label: s.label || null,
          optional: !!s.optional,
        })),
      };
      if (editingId) await api.put(`/approval-chains/${editingId}`, payload);
      else await api.post("/approval-chains", payload);
      setOpen(false);
      load();
      toast.success(editingId ? "Updated" : "Created");
    } catch (e) { toast.error(formatError(e)); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete chain "${c.name}"?`)) return;
    try { await api.delete(`/approval-chains/${c.id}`); load(); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); }
  };

  const toggleActive = async (c) => {
    try {
      const cids = Array.isArray(c.center_ids) && c.center_ids.length > 0
        ? c.center_ids
        : (c.center_id ? [c.center_id] : []);
      await api.put(`/approval-chains/${c.id}`, { name: c.name, type: c.type, center_ids: cids, steps: c.steps, active: !c.active });
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const addStep = () => setForm((f) => ({ ...f, steps: [...f.steps, emptyStep()] }));
  const removeStep = (idx) => setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }));
  const setStep = (idx, patch) => setForm((f) => ({ ...f, steps: f.steps.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  const moveStep = (idx, dir) => setForm((f) => {
    const arr = [...f.steps];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return f;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    return { ...f, steps: arr };
  });

  const chainsByType = (t) => chains.filter((c) => c.type === t);

  const stepValueInput = (step, idx) => {
    if (step.kind === "role") {
      return (
        <Select value={step.value || ""} onValueChange={(v) => setStep(idx, { value: v })}>
          <SelectTrigger className="rounded-none" data-testid={`step-${idx}-role`}><SelectValue placeholder="Select role" /></SelectTrigger>
          <SelectContent>{ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (step.kind === "staff") {
      // Only staff with a linked user-account (login) can be approvers — others can't
      // receive notifications and won't be allowed through chain save validation.
      const eligible = staffList.filter((s) => s.user_id);
      return (
        <Select value={step.value || ""} onValueChange={(v) => setStep(idx, { value: v })}>
          <SelectTrigger className="rounded-none" data-testid={`step-${idx}-staff`}>
            <SelectValue placeholder={eligible.length ? "Select staff" : "No staff with login — create users first"} />
          </SelectTrigger>
          <SelectContent>
            {eligible.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--muted)]">No staff has a linked login yet. Go to Users → add a user with the staff&apos;s email.</div>
            ) : eligible.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name} {s.designation ? `· ${s.designation}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (step.kind === "user") {
      return (
        <Select value={step.value || ""} onValueChange={(v) => setStep(idx, { value: v })}>
          <SelectTrigger className="rounded-none" data-testid={`step-${idx}-user`}><SelectValue placeholder="Select user" /></SelectTrigger>
          <SelectContent>{usersList.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    // reports_to → depth integer
    return (
      <Input
        type="number" min={1} max={10}
        value={step.value || "1"}
        onChange={(e) => setStep(idx, { value: e.target.value })}
        placeholder="Depth (1 = direct manager)"
        className="rounded-none"
        data-testid={`step-${idx}-depth`}
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="overline">Settings · Workflows</div>
          <h1 className="font-heading font-black text-4xl mt-1">Approval Workflows</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">Configure who approves reimbursements, leaves, and transactions — at each level. Each request type uses the one ACTIVE chain at submit-time; in-flight items keep their snapshot.</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton title="Approval Workflows" />
          {canEdit && (
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditingId(null); } }}>
              <DialogTrigger asChild>
                <Button onClick={openCreate} className="brand-btn rounded-none gap-2" data-testid="btn-new-chain"><Plus size={16} /> New Chain</Button>
              </DialogTrigger>
              <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="font-heading">{editingId ? "Edit Approval Chain" : "New Approval Chain"}</DialogTitle></DialogHeader>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><Label>Chain Name <span className="text-[var(--danger)]">*</span></Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Reimbursement — Field staff" className="rounded-none" data-testid="chain-name" /></div>
                    <div><Label>Request Type</Label>
                      <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                        <SelectTrigger className="rounded-none" data-testid="chain-type"><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2"><Label>Centers <span className="text-[var(--muted)] text-[10px] normal-case">(select one or more — leave empty for global fallback)</span></Label>
                      <div className="border border-[var(--border)] rounded-none bg-white p-2 max-h-40 overflow-y-auto space-y-1" data-testid="chain-centers">
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={(form.center_ids || []).length === 0}
                            onChange={(e) => { if (e.target.checked) setForm({ ...form, center_ids: [] }); }}
                            data-testid="chain-center-global"
                          />
                          <span className="font-medium text-[var(--brand)]">All Centers (Global Default)</span>
                        </label>
                        <div className="border-t border-[var(--border)] my-1" />
                        {centersList.map((c) => {
                          const checked = (form.center_ids || []).includes(c.id);
                          return (
                            <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--background)] px-1">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setForm((f) => ({
                                  ...f,
                                  center_ids: checked
                                    ? f.center_ids.filter((x) => x !== c.id)
                                    : [...(f.center_ids || []), c.id],
                                }))}
                                data-testid={`chain-center-${c.id}`}
                              />
                              <span>{c.name}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="text-[10px] text-[var(--muted)] mt-1">
                        {(form.center_ids || []).length === 0
                          ? "Chain will apply as GLOBAL fallback for centers without a specific chain."
                          : `Chain will apply to ${form.center_ids.length} center(s) only.`}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="chain-active" />
                        <span><span className="font-medium">Active</span> <span className="text-[var(--muted)]">— one active chain per center (multiple centers can share one chain)</span></span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="overline text-[var(--brand)]">Approval Steps</div>
                      <Button onClick={addStep} variant="outline" size="sm" className="rounded-none gap-1 h-8" data-testid="add-step"><Plus size={14} /> Add Step</Button>
                    </div>
                    <div className="space-y-3">
                      {form.steps.map((step, idx) => (
                        <div key={idx} className="border border-[var(--border)] p-3 bg-gray-50" data-testid={`step-row-${idx}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex flex-col">
                              <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="text-[var(--muted)] hover:text-[var(--brand)] disabled:opacity-30 text-xs leading-none">▲</button>
                              <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === form.steps.length - 1} className="text-[var(--muted)] hover:text-[var(--brand)] disabled:opacity-30 text-xs leading-none">▼</button>
                            </div>
                            <div className="font-heading font-bold text-base">Level {idx + 1}</div>
                            <div className="flex-1" />
                            <Button onClick={() => removeStep(idx)} variant="outline" size="sm" className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" data-testid={`remove-step-${idx}`}><Trash2 size={14} /></Button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="overline">Approver Kind</Label>
                              <Select value={step.kind} onValueChange={(v) => setStep(idx, { kind: v, value: v === "reports_to" ? "1" : "" })}>
                                <SelectTrigger className="rounded-none" data-testid={`step-${idx}-kind`}><SelectValue /></SelectTrigger>
                                <SelectContent>{KINDS.map((k) => <SelectItem key={k.v} value={k.v}>{k.label}</SelectItem>)}</SelectContent>
                              </Select>
                              <div className="text-[10px] text-[var(--muted)] mt-1">{KINDS.find((k) => k.v === step.kind)?.help}</div>
                            </div>
                            <div>
                              <Label className="overline">Approver Value</Label>
                              {stepValueInput(step, idx)}
                            </div>
                            <div>
                              <Label className="overline">Display Label</Label>
                              <Input value={step.label || ""} onChange={(e) => setStep(idx, { label: e.target.value })} placeholder="e.g. Account Officer" className="rounded-none" />
                            </div>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={!!step.optional} onChange={(e) => setStep(idx, { optional: e.target.checked })} />
                                <span><span className="font-medium">Optional</span> <span className="text-[var(--muted)]">— skip if no approver resolvable</span></span>
                              </label>
                            </div>
                          </div>
                        </div>
                      ))}
                      {form.steps.length === 0 && (
                        <div className="overline text-center py-8 text-[var(--muted)]">No steps yet — click <em>Add Step</em></div>
                      )}
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={() => setOpen(false)} variant="outline" className="rounded-none">Cancel</Button>
                  <Button onClick={save} className="brand-btn rounded-none" data-testid="chain-save">{editingId ? "Update" : "Create"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Grouped by type */}
      {TYPES.map((t) => (
        <div key={t.v} className="space-y-2">
          <div className="overline text-[var(--brand)]">{t.label}</div>
          {chainsByType(t.v).length === 0 ? (
            <div className="swiss-card p-6 text-center text-sm text-[var(--muted)]">No chain configured for {t.label}. Defaults are seeded on startup — refresh if missing.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {chainsByType(t.v).map((c) => {
                // Merge new `center_ids` with legacy `center_id` for display so
                // freshly-migrated chains that still store a single value keep
                // rendering correctly.
                const cids = Array.isArray(c.center_ids) && c.center_ids.length > 0
                  ? c.center_ids
                  : (c.center_id ? [c.center_id] : []);
                const centerNames = cids
                  .map((cid) => centersList.find((x) => x.id === cid)?.name || "Unknown")
                  .filter(Boolean);
                return (
                <div key={c.id} className={`swiss-card p-4 ${c.active ? "border-l-4 border-[var(--brand)]" : "opacity-70"}`} data-testid={`chain-card-${c.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="font-heading font-bold text-lg leading-tight flex items-center gap-2">
                        <GitMerge size={18} className="text-[var(--brand)]" /> {c.name}
                      </div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">
                        {c.steps?.length || 0} steps · {c.active ? <span className="text-[var(--success)] font-medium">Active</span> : <span>Inactive</span>}
                        {" · "}
                        {centerNames.length === 0
                          ? <span>All Centers (Global)</span>
                          : centerNames.length === 1
                            ? <span className="font-medium text-[var(--brand)]">Center: {centerNames[0]}</span>
                            : <span className="font-medium text-[var(--brand)]" title={centerNames.join(", ")}>{centerNames.length} centers: {centerNames.slice(0, 2).join(", ")}{centerNames.length > 2 ? `, +${centerNames.length - 2}` : ""}</span>}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 no-print">
                        <Button onClick={() => toggleActive(c)} variant="outline" size="sm" className="rounded-none h-8 px-2" title={c.active ? "Deactivate" : "Activate"} data-testid={`chain-toggle-${c.id}`}><Power size={14} /></Button>
                        <Button onClick={() => openEdit(c)} variant="outline" size="sm" className="rounded-none h-8 px-2" data-testid={`chain-edit-${c.id}`}><Pencil size={14} /></Button>
                        <Button onClick={() => remove(c)} variant="outline" size="sm" className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" data-testid={`chain-delete-${c.id}`}><Trash2 size={14} /></Button>
                      </div>
                    )}
                  </div>
                  <ol className="space-y-2">
                    {(c.steps || []).sort((a, b) => a.level - b.level).map((s) => (
                      <li key={s.level} className="flex items-start gap-3 text-sm">
                        <div className="w-6 h-6 bg-[var(--brand)] text-white text-xs font-bold flex items-center justify-center shrink-0">{s.level}</div>
                        <div className="flex-1">
                          <div className="font-medium">{s.label || formatKind(s)}</div>
                          <div className="text-xs text-[var(--muted)] mt-0.5">{formatKind(s)}{s.optional ? " · optional" : ""}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatKind(step) {
  if (step.kind === "role") return `Role: ${step.value}`;
  if (step.kind === "staff") return `Staff: ${step.value?.slice(0, 8)}…`;
  if (step.kind === "user") return `User: ${step.value?.slice(0, 8)}…`;
  if (step.kind === "reports_to") return `Reports-To (depth ${step.value || 1})`;
  return step.kind;
}
