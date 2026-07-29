import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Search, Users } from "lucide-react";

const emptyVendor = {
  name: "", gst_number: "", pan_number: "", contact_person: "", mobile: "", email: "",
  address: "", bank_account_no: "", bank_name: "", ifsc: "", account_holder_name: "", notes: "",
  active: true, center_ids: [],
};

/**
 * Vendor Master — reusable directory of suppliers/service providers.
 * Referenced by quotations (vendor_id) so procurement analytics can roll up
 * spend per vendor without string-matching typo'd names.
 */
export default function Vendors() {
  const { user } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [centers, setCenters] = useState([]);
  const [q, setQ] = useState("");
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState(emptyVendor);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const canEdit = ["admin", "hr", "manager", "senior_manager", "accountant", "center_manager"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const isCenterManager = user?.role === "center_manager";
  // Center Manager sees only their assigned centers in the picker; HQ roles see all.
  const availableCenters = useMemo(() => {
    if (isCenterManager) {
      const my = new Set(user?.assigned_center_ids || []);
      return centers.filter((c) => my.has(c.id));
    }
    return centers;
  }, [centers, isCenterManager, user]);

  const load = () => api.get("/vendors").then((r) => setVendors(r.data || [])).catch((e) => toast.error(formatError(e)));
  useEffect(() => {
    load();
    api.get("/entities/center").then((r) => setCenters(r.data || [])).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return vendors;
    return vendors.filter((v) =>
      (v.name || "").toLowerCase().includes(t)
      || (v.gst_number || "").toLowerCase().includes(t)
      || (v.contact_person || "").toLowerCase().includes(t)
      || (v.mobile || "").includes(t),
    );
  }, [vendors, q]);

  const openNew = () => {
    // Pre-select the Center Manager's own centers so they can save immediately
    const preset = isCenterManager ? { ...emptyVendor, center_ids: user?.assigned_center_ids || [] } : emptyVendor;
    setForm(preset);
    setEditingId(null);
    setOpenForm(true);
  };
  const openEdit = (v) => {
    setForm({ ...emptyVendor, ...v, center_ids: v.center_ids || [] });
    setEditingId(v.id);
    setOpenForm(true);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Vendor name is required"); return; }
    if (isCenterManager && (form.center_ids || []).length === 0) {
      toast.error("Please pick at least one of your assigned centers");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/vendors/${editingId}`, form);
        toast.success("Vendor updated");
      } else {
        await api.post("/vendors", form);
        toast.success("Vendor added");
      }
      setOpenForm(false);
      setForm(emptyVendor);
      setEditingId(null);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBusy(false); }
  };

  const remove = async (v) => {
    if (!window.confirm(`Delete vendor "${v.name}"? Any historical quotations remain intact.`)) return;
    try {
      await api.delete(`/vendors/${v.id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="vendors-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="overline">MASTER · PROCUREMENT</div>
          <h1 className="font-heading font-bold text-3xl tracking-tight mt-1 flex items-center gap-2">
            <Users size={28} className="text-[var(--brand)]" /> Vendors
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
            Central vendor directory used by Payment Requests. Store GST, PAN, contact and bank details once —
            then just pick from a dropdown when raising a new request.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew} className="rounded-none brand-btn" data-testid="vendor-add-btn">
            <Plus size={16} className="mr-2" /> Add Vendor
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <Search size={16} className="text-[var(--muted)]" />
        <Input
          placeholder="Search vendor name / GST / contact / phone…"
          value={q} onChange={(e) => setQ(e.target.value)}
          className="rounded-none max-w-md" data-testid="vendor-search"
        />
        <span className="text-xs text-[var(--muted)]">{filtered.length} of {vendors.length}</span>
      </div>

      {/* Table */}
      <div className="swiss-card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--muted)]">
            No vendors yet. Click <strong>Add Vendor</strong> to seed your first entry.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">GST</th>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">Bank</th>
                <th className="text-left p-3">Centers</th>
                <th className="text-left p-3">Status</th>
                {canEdit && <th className="text-right p-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const vCenterIds = v.center_ids || [];
                const vCenterNames = vCenterIds
                  .map((cid) => centers.find((c) => c.id === cid)?.name)
                  .filter(Boolean);
                // Center Manager can only edit their own scoped vendors (not legacy globals)
                const canEditRow = canEdit && (
                  !isCenterManager
                  || (vCenterIds.some((cid) => (user?.assigned_center_ids || []).includes(cid)))
                );
                return (
                <tr key={v.id} className="border-b border-[var(--border)] last:border-0" data-testid={`vendor-row-${v.id}`}>
                  <td className="p-3">
                    <div className="font-medium">{v.name}</div>
                    {v.address && <div className="text-[10px] text-[var(--muted)] max-w-[220px] truncate">{v.address}</div>}
                  </td>
                  <td className="p-3 num text-xs">{v.gst_number || <span className="text-[var(--muted)]">—</span>}</td>
                  <td className="p-3 text-xs">
                    {v.contact_person && <div>{v.contact_person}</div>}
                    {v.mobile && <div className="num text-[10px] text-[var(--muted)]">{v.mobile}</div>}
                    {v.email && <div className="text-[10px] text-[var(--muted)]">{v.email}</div>}
                  </td>
                  <td className="p-3 text-xs">
                    {v.bank_name && <div>{v.bank_name}</div>}
                    {v.bank_account_no && <div className="num text-[10px] text-[var(--muted)]">A/c {v.bank_account_no}</div>}
                    {v.ifsc && <div className="num text-[10px] text-[var(--muted)]">{v.ifsc}</div>}
                  </td>
                  <td className="p-3 text-[11px]">
                    {vCenterNames.length === 0 ? (
                      <span className="text-[var(--muted)] italic">Global</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {vCenterNames.slice(0, 2).map((n, i) => (
                          <span key={i} className="inline-block bg-cyan-50 border border-cyan-200 text-cyan-800 px-1.5 py-0.5">{n}</span>
                        ))}
                        {vCenterNames.length > 2 && (
                          <span className="text-[var(--muted)]" title={vCenterNames.join(', ')}>+{vCenterNames.length - 2}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 border ${v.active !== false ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      {v.active !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        {canEditRow ? (
                          <Button size="sm" variant="outline" className="rounded-none h-8 px-2" onClick={() => openEdit(v)} data-testid={`vendor-edit-${v.id}`}><Pencil size={12} /></Button>
                        ) : (
                          <span className="text-[10px] text-[var(--muted)] italic" title="HQ-owned vendor — you can view but not edit">HQ</span>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="outline" className="rounded-none h-8 px-2 text-[var(--danger)] hover:bg-red-50" onClick={() => remove(v)} data-testid={`vendor-delete-${v.id}`}><Trash2 size={12} /></Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Form Dialog */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="vendor-form">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
            <DialogDescription>Central vendor directory — GST, PAN, contact and bank details.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="overline">Vendor Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-none" data-testid="v-name" />
            </div>
            <div><Label className="overline">GST Number</Label>
              <Input value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value.toUpperCase() })} className="rounded-none num" data-testid="v-gst" />
            </div>
            <div><Label className="overline">PAN Number</Label>
              <Input value={form.pan_number} onChange={(e) => setForm({ ...form, pan_number: e.target.value.toUpperCase() })} className="rounded-none num" data-testid="v-pan" />
            </div>
            <div><Label className="overline">Contact Person</Label>
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="rounded-none" data-testid="v-contact" />
            </div>
            <div><Label className="overline">Mobile</Label>
              <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="rounded-none num" data-testid="v-mobile" />
            </div>
            <div className="col-span-2"><Label className="overline">Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-none" data-testid="v-email" />
            </div>
            <div className="col-span-2"><Label className="overline">Address</Label>
              <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-none" data-testid="v-address" />
            </div>
            <div className="col-span-2 pt-2 border-t border-[var(--border)]">
              <div className="overline mb-1">Assigned Centers</div>
              <div className="text-[11px] text-[var(--muted)] mb-2">
                {isCenterManager
                  ? "Auto-populated with your assigned centers. This vendor will only be visible to staff of these centers."
                  : "Leave blank to make this vendor globally visible. Pick specific centers to restrict visibility."}
              </div>
              <div className="border border-[var(--border)] max-h-40 overflow-y-auto">
                {availableCenters.length === 0 && (
                  <div className="text-xs text-[var(--muted)] p-2">No centers available.</div>
                )}
                {availableCenters.map((c) => {
                  const checked = (form.center_ids || []).includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm border-b border-[var(--border)] last:border-b-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(form.center_ids || []);
                          if (e.target.checked) next.add(c.id); else next.delete(c.id);
                          setForm({ ...form, center_ids: [...next] });
                        }}
                        data-testid={`v-center-${c.id}`}
                      />
                      <span>{c.name}</span>
                    </label>
                  );
                })}
              </div>
              {isCenterManager && (form.center_ids || []).length === 0 && (
                <div className="text-[11px] text-red-700 mt-1">Please pick at least one of your centers.</div>
              )}
            </div>

            <div className="col-span-2 pt-2 border-t border-[var(--border)]">
              <div className="overline mb-1">Bank Details (for direct-transfer payments)</div>
            </div>
            <div className="col-span-2"><Label className="overline">Account Holder Name</Label>
              <Input value={form.account_holder_name} onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })} className="rounded-none" data-testid="v-holder" />
            </div>
            <div><Label className="overline">Bank Name</Label>
              <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="rounded-none" data-testid="v-bank" />
            </div>
            <div><Label className="overline">Account No.</Label>
              <Input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} className="rounded-none num" data-testid="v-acc" />
            </div>
            <div><Label className="overline">IFSC</Label>
              <Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} className="rounded-none num" data-testid="v-ifsc" />
            </div>
            <div className="col-span-2"><Label className="overline">Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-none" data-testid="v-notes" />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                <span className="text-sm">Active — show in Payment Request vendor picker</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setOpenForm(false)}>Cancel</Button>
            <Button onClick={submit} disabled={busy} className="rounded-none brand-btn" data-testid="v-submit">
              {busy ? "Saving…" : (editingId ? "Save Changes" : "Add Vendor")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
