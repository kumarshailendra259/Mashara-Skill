import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  MapPin, Plus, Building2, CheckCircle2, XCircle, Pencil, Search,
  ShieldCheck, ShieldOff, Save, RefreshCw, TrendingUp, TrendingDown,
  Wallet, ArrowDownCircle, ArrowUpCircle, BarChart3,
} from "lucide-react";

const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

const EMPTY_CENTER = {
  name: "", address: "", city: "", state: "", pincode: "",
  contact_name: "", contact_mobile: "", contact_email: "",
  center_status: "active",
};

function Kpi({ label, value, tone = "slate", testid }) {
  const tones = {
    slate: "text-slate-900", blue: "text-blue-600",
    emerald: "text-emerald-600", amber: "text-amber-600",
  };
  return (
    <div className="swiss-card p-4" data-testid={testid}>
      <div className="overline text-[10px]">{label}</div>
      <div className={`font-heading font-black text-3xl mt-1 ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export default function CenterManagement() {
  const { user, companies, isSuperCompanies } = useAuth();
  const isSuperAdmin = user?.role === "admin";

  const [companyId, setCompanyId] = useState("");
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  // Add/Edit center dialog
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_CENTER);
  const [saving, setSaving] = useState(false);

  // Access multi-select
  const [accessMode, setAccessMode] = useState(false);
  const [enabledIds, setEnabledIds] = useState(new Set());
  const [savingAccess, setSavingAccess] = useState(false);

  // Financial reports (per-center P&L)
  const [reports, setReports] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [includePending, setIncludePending] = useState(false);

  // Company list for the super-admin selector.
  const companyOptions = useMemo(() => companies || [], [companies]);

  useEffect(() => {
    if (!companyId && companyOptions.length > 0) {
      setCompanyId(companyOptions[0].id);
    }
  }, [companyOptions, companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = companyId ? `/centers?company_id=${companyId}` : "/centers";
      const { data } = await api.get(url);
      setCenters(data || []);
      setEnabledIds(new Set((data || []).filter((c) => c.access_status === "enabled").map((c) => c.id)));
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { if (companyId) load(); }, [companyId, load]);

  const loadReports = useCallback(async () => {
    if (!companyId) return;
    setReportsLoading(true);
    try {
      const { data } = await api.get(`/centers/reports?company_id=${companyId}&include_pending=${includePending}`);
      setReports(data);
    } catch (e) {
      toast.error(formatError(e));
      setReports(null);
    } finally {
      setReportsLoading(false);
    }
  }, [companyId, includePending]);

  useEffect(() => { if (companyId) loadReports(); }, [companyId, includePending, loadReports]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return centers;
    return centers.filter((c) =>
      (c.name || "").toLowerCase().includes(s) ||
      (c.center_code || "").toLowerCase().includes(s) ||
      (c.city || "").toLowerCase().includes(s));
  }, [centers, q]);

  const stats = useMemo(() => {
    const total = centers.length;
    const activeC = centers.filter((c) => c.center_status === "active").length;
    const enabled = centers.filter((c) => c.access_status === "enabled").length;
    return { total, activeC, enabled, disabled: total - enabled };
  }, [centers]);

  const openAdd = () => { setEditing(null); setForm(EMPTY_CENTER); setDlgOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || "", address: c.address || "", city: c.city || "",
      state: c.state || "", pincode: c.pincode || "",
      contact_name: c.contact_name || "", contact_mobile: c.contact_mobile || "",
      contact_email: c.contact_email || "", center_status: c.center_status || "active",
    });
    setDlgOpen(true);
  };

  const saveCenter = async () => {
    if (!form.name.trim()) { toast.error("Center name is required"); return; }
    if (!companyId) { toast.error("Select a company first"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/centers/${editing.id}`, form);
        toast.success("Center updated");
      } else {
        await api.post("/centers", { company_id: companyId, ...form });
        toast.success("Center created — code auto-generated");
      }
      setDlgOpen(false);
      await load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleAccess = async (c) => {
    const next = c.access_status === "enabled" ? "disabled" : "enabled";
    try {
      await api.patch(`/centers/${c.id}`, { access_status: next });
      toast.success(`Access ${next} for ${c.center_code}`);
      await load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const toggleEnabled = (id) => setEnabledIds((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const selectAll = () => setEnabledIds(new Set(centers.map((c) => c.id)));
  const clearAll = () => setEnabledIds(new Set());

  const saveAccess = async () => {
    setSavingAccess(true);
    try {
      await api.post("/centers/set-access", {
        company_id: companyId,
        enabled_center_ids: Array.from(enabledIds),
        access_type: "free",
      });
      toast.success("Center access saved");
      setAccessMode(false);
      await load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setSavingAccess(false);
    }
  };

  const activeCompany = companyOptions.find((c) => c.id === companyId);

  return (
    <div className="space-y-5" data-testid="center-management-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline flex items-center gap-2"><MapPin size={12} /> Center Management</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">Centers</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-none gap-1" onClick={load} data-testid="centers-refresh">
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button className="rounded-none gap-1" onClick={openAdd} data-testid="add-center-btn">
            <Plus size={14} /> Add Center
          </Button>
        </div>
      </div>

      {/* Company selector */}
      <div className="swiss-card p-4 flex flex-wrap items-end gap-4">
        <div className="min-w-[240px]">
          <Label className="text-xs flex items-center gap-1"><Building2 size={12} /> Company</Label>
          <Select value={companyId} onValueChange={setCompanyId} disabled={!isSuperAdmin && companyOptions.length <= 1}>
            <SelectTrigger className="rounded-none mt-1" data-testid="center-company-select"><SelectValue placeholder="Select company" /></SelectTrigger>
            <SelectContent>
              {companyOptions.map((c) => (
                <SelectItem key={c.id} value={c.id} data-testid={`company-opt-${c.id}`}>
                  {c.name} ({c.company_code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Label className="text-xs">Search</Label>
          <div className="relative mt-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by code, name, city" className="rounded-none pl-8" data-testid="center-search" />
          </div>
        </div>
        <Button
          variant={accessMode ? "default" : "outline"}
          className="rounded-none gap-1"
          onClick={() => setAccessMode((v) => !v)}
          data-testid="toggle-access-mode"
        >
          <ShieldCheck size={14} /> {accessMode ? "Cancel Access Edit" : "Manage Access"}
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Centers" value={stats.total} tone="slate" testid="kpi-total" />
        <Kpi label="Active" value={stats.activeC} tone="blue" testid="kpi-active" />
        <Kpi label="Access Enabled" value={stats.enabled} tone="emerald" testid="kpi-enabled" />
        <Kpi label="Access Disabled" value={stats.disabled} tone="amber" testid="kpi-disabled" />
      </div>

      {/* Access multi-select panel */}
      {accessMode && (
        <div className="swiss-card p-4 border-l-4 border-[var(--brand)]" data-testid="access-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <div className="font-bold">Select Centers for Access</div>
              <div className="text-xs text-[var(--muted)]">
                Checked centers get access ENABLED; unchecked get DISABLED for {activeCompany?.name}.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="rounded-none" onClick={selectAll} data-testid="access-select-all">Select All</Button>
              <Button size="sm" variant="outline" className="rounded-none" onClick={clearAll} data-testid="access-clear-all">Clear All</Button>
              <Button size="sm" className="rounded-none gap-1" onClick={saveAccess} disabled={savingAccess} data-testid="access-save">
                <Save size={13} /> {savingAccess ? "Saving…" : "Save Access"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {centers.map((c) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 p-2 border cursor-pointer ${enabledIds.has(c.id) ? "border-[var(--brand)] bg-blue-50/40" : "border-gray-200"}`}
                data-testid={`access-row-${c.id}`}
              >
                <Checkbox checked={enabledIds.has(c.id)} onCheckedChange={() => toggleEnabled(c.id)} data-testid={`access-check-${c.id}`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-[10px] font-mono text-[var(--muted)]">{c.center_code}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Centers table */}
      <div className="swiss-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">Center Code</th>
              <th className="text-left p-3">Center Name</th>
              <th className="text-left p-3">City</th>
              <th className="text-left p-3">Access</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3 w-32">Actions</th>
            </tr>
          </thead>
          <tbody data-testid="centers-table-body">
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 overline">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 overline">No centers found</td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border)] hover:bg-gray-50" data-testid={`center-row-${c.id}`}>
                <td className="p-3 font-mono text-xs font-semibold text-[var(--brand)]">{c.center_code}</td>
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-[var(--muted)]">{c.city || "—"}</td>
                <td className="p-3">
                  {c.access_status === "enabled" ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-xs"><CheckCircle2 size={13} /> Enabled</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 text-xs"><XCircle size={13} /> Disabled</span>
                  )}
                </td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 text-xs border ${c.center_status === "active" ? "border-blue-300 text-blue-700" : "border-gray-300 text-gray-500"}`}>
                    {c.center_status === "active" ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="rounded-none h-8 w-8" onClick={() => toggleAccess(c)} title="Toggle access" data-testid={`center-toggle-access-${c.id}`}>
                      {c.access_status === "enabled" ? <ShieldOff size={14} className="text-amber-600" /> : <ShieldCheck size={14} className="text-emerald-600" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="rounded-none h-8 w-8" onClick={() => openEdit(c)} title="Edit" data-testid={`center-edit-${c.id}`}>
                      <Pencil size={14} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Financial Summary (per-center P&L) */}
      <div className="space-y-3" data-testid="center-reports-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="overline flex items-center gap-2"><BarChart3 size={12} /> Financial Summary {includePending ? "(Approved + Pending)" : "(Approved)"}</div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="reports-include-pending">
            <Checkbox checked={includePending} onCheckedChange={(v) => setIncludePending(!!v)} />
            Include pending entries
          </label>
        </div>

        {/* Company totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="swiss-card p-4" data-testid="rep-total-investment">
            <div className="overline text-[10px] flex items-center gap-1"><Wallet size={11} /> Investment</div>
            <div className="font-heading font-black text-2xl mt-1 text-indigo-600">{fmtINR(reports?.totals?.investment)}</div>
          </div>
          <div className="swiss-card p-4" data-testid="rep-total-income">
            <div className="overline text-[10px] flex items-center gap-1"><ArrowUpCircle size={11} /> Income</div>
            <div className="font-heading font-black text-2xl mt-1 text-emerald-600">{fmtINR(reports?.totals?.income)}</div>
          </div>
          <div className="swiss-card p-4" data-testid="rep-total-expense">
            <div className="overline text-[10px] flex items-center gap-1"><ArrowDownCircle size={11} /> Expense</div>
            <div className="font-heading font-black text-2xl mt-1 text-rose-600">{fmtINR(reports?.totals?.expense)}</div>
          </div>
          <div className="swiss-card p-4" data-testid="rep-total-profit">
            <div className="overline text-[10px] flex items-center gap-1">
              {(reports?.totals?.profit || 0) >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} Profit / Loss
            </div>
            <div className={`font-heading font-black text-2xl mt-1 ${(reports?.totals?.profit || 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {fmtINR(reports?.totals?.profit)}
            </div>
          </div>
        </div>

        {/* Per-center P&L table */}
        <div className="swiss-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] overline bg-gray-50">
                <th className="text-left p-3">Center Code</th>
                <th className="text-left p-3">Center Name</th>
                <th className="text-right p-3">Investment</th>
                <th className="text-right p-3">Income</th>
                <th className="text-right p-3">Expense</th>
                <th className="text-right p-3">Profit / Loss</th>
              </tr>
            </thead>
            <tbody data-testid="reports-table-body">
              {reportsLoading ? (
                <tr><td colSpan={6} className="text-center py-8 overline">Loading…</td></tr>
              ) : !reports || reports.centers.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 overline">No data</td></tr>
              ) : reports.centers.map((r) => (
                <tr key={r.center_id} className="border-b border-[var(--border)] hover:bg-gray-50" data-testid={`report-row-${r.center_id}`}>
                  <td className="p-3 font-mono text-xs font-semibold text-[var(--brand)]">{r.center_code}</td>
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-right tabular-nums text-indigo-700">{fmtINR(r.investment)}</td>
                  <td className="p-3 text-right tabular-nums text-emerald-700">{fmtINR(r.income)}</td>
                  <td className="p-3 text-right tabular-nums text-rose-700">{fmtINR(r.expense)}</td>
                  <td className={`p-3 text-right tabular-nums font-semibold ${r.profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtINR(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">
              {editing ? `Edit Center · ${editing.center_code}` : "Add Center"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <div className="text-xs bg-blue-50 border border-blue-200 text-blue-800 p-2">
                Center Code will be auto-generated (e.g. {activeCompany?.company_code}-XXXX). No manual entry needed.
              </div>
            )}
            <div>
              <Label className="text-xs">Center Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-none mt-1" data-testid="center-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="rounded-none mt-1" data-testid="center-city-input" />
              </div>
              <div>
                <Label className="text-xs">State</Label>
                <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="rounded-none mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-none mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contact Name</Label>
                <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="rounded-none mt-1" data-testid="center-contact-name" />
              </div>
              <div>
                <Label className="text-xs">Contact Mobile</Label>
                <Input value={form.contact_mobile} onChange={(e) => setForm({ ...form, contact_mobile: e.target.value })} className="rounded-none mt-1" data-testid="center-contact-mobile" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contact Email</Label>
                <Input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="rounded-none mt-1" />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={form.center_status} onValueChange={(v) => setForm({ ...form, center_status: v })}>
                  <SelectTrigger className="rounded-none mt-1" data-testid="center-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button className="rounded-none" onClick={saveCenter} disabled={saving} data-testid="save-center-btn">
              {saving ? "Saving…" : editing ? "Update Center" : "Create Center"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
