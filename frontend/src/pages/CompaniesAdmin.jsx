import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Search, RefreshCw, Filter, Download, Gift, UserPlus, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { api, formatError } from "@/lib/api";

const inr = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((paise || 0) / 100);
const dt  = (iso) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function CompaniesAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [grantOpen, setGrantOpen] = useState(false);
  const [caOpen, setCaOpen] = useState(false);
  const [target, setTarget] = useState(null);
  const [features, setFeatures] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (q.trim()) params.q = q.trim();
      if (status !== "all") params.status = status;
      const r = await api.get("/companies-admin/list", { params });
      setRows(r.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  }, [q, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/subscription/pricing")
      .then((r) => setFeatures(r.data?.features || []))
      .catch(() => {});
  }, []);

  const openGrant = (row) => { setTarget(row); setGrantOpen(true); };
  const openCA = (row) => { setTarget(row); setCaOpen(true); };

  const totalCompanies = rows.length;
  const activeCount    = rows.filter((r) => r.subscription_status === "active").length;
  const totalHrmsUsed  = rows.reduce((s, r) => s + (r.hrms_used || 0), 0);
  const totalRoleUsed  = rows.reduce((s, r) => s + (r.role_user_used || 0), 0);
  const totalHrmsBought= rows.reduce((s, r) => s + (r.hrms_purchased || 0), 0);
  const totalRoleBought= rows.reduce((s, r) => s + (r.role_user_purchased || 0), 0);
  const totalRevenue   = rows.reduce((s, r) => s + (r.latest_order_amount || 0), 0);

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = ["Company Name","Company Code","Plan","HRMS Purchased","HRMS Used","Role/User Purchased","Role/User Used","Status","Expiry","Latest Payment"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(",")].concat(rows.map((r) => [
      r.company_name, r.company_code, r.plan, r.hrms_purchased, r.hrms_used,
      r.role_user_purchased, r.role_user_used, r.subscription_status,
      r.expiry_date ? dt(r.expiry_date) : "",
      r.latest_payment || "",
    ].map(escape).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `companies_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto" data-testid="companies-admin-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
            <Building2 size={14}/> Super Admin
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mt-1" data-testid="ca-heading">Companies</h1>
          <div className="text-sm text-slate-500 mt-1">All tenants — subscriptions, license usage, payments</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="export-csv"><Download size={14} className="mr-1"/> CSV</Button>
          <Button variant="outline" size="sm" onClick={load} data-testid="refresh"><RefreshCw size={14} className="mr-1"/> Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Companies" value={totalCompanies} testid="k-total"/>
        <Kpi label="Active Subs" value={activeCount} accent="emerald" testid="k-active"/>
        <Kpi label="HRMS Licenses" value={`${totalHrmsUsed}/${totalHrmsBought}`} testid="k-hrms"/>
        <Kpi label="Role/User Licenses" value={`${totalRoleUsed}/${totalRoleBought}`} testid="k-role"/>
        <Kpi label="Recent Revenue" value={inr(totalRevenue)} accent="blue" testid="k-revenue"/>
      </div>

      <Card className="p-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 mb-4">
          <div className="flex-1 flex items-center gap-2 border rounded-md px-3 h-10 bg-white">
            <Search size={14} className="text-slate-400"/>
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="Search by company name, code or payment ID…"
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              data-testid="search-input"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48" data-testid="status-filter"><Filter size={14} className="mr-1"/> <SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="expired">Expired only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-widest text-slate-500 border-b">
              <tr>
                <th className="text-left py-2">Company</th>
                <th className="text-left">Code</th>
                <th className="text-left">Modules</th>
                <th className="text-right">HRMS Used/Bought</th>
                <th className="text-right">Role/User Used/Bought</th>
                <th className="text-left">Status</th>
                <th className="text-left">Expiry</th>
                <th className="text-left">Latest Payment</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="py-8 text-center text-slate-400">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-slate-400">No companies</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.company_id} className="border-b last:border-0 hover:bg-slate-50" data-testid={`company-row-${r.company_code}`}>
                  <td className="py-2 font-semibold text-slate-900">
                    {r.company_name || "—"}
                    {r.has_free_grant && <Badge className="ml-2 bg-purple-100 text-purple-700 text-[10px]" data-testid={`badge-free-${r.company_code}`}><Gift size={10} className="mr-0.5"/> Free</Badge>}
                  </td>
                  <td className="font-mono text-[11px] text-slate-500">{r.company_code || "—"}</td>
                  <td className="text-xs text-slate-500 max-w-[200px] truncate" title={r.plan}>{r.plan}</td>
                  <td className="text-right tabular-nums"><span className="font-bold">{r.hrms_used || 0}</span><span className="text-slate-400"> / {r.hrms_purchased || 0}</span></td>
                  <td className="text-right tabular-nums"><span className="font-bold">{r.role_user_used || 0}</span><span className="text-slate-400"> / {r.role_user_purchased || 0}</span></td>
                  <td><Badge className={r.subscription_status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>{r.subscription_status}</Badge></td>
                  <td className="text-slate-500 text-xs">{dt(r.expiry_date)}</td>
                  <td>
                    {r.latest_payment
                      ? <div className="text-[11px] font-mono text-slate-500">{r.latest_payment}<div className="text-[10px] text-slate-400">{inr(r.latest_order_amount)} · {dt(r.latest_order_at)}</div></div>
                      : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" className="mr-1" onClick={() => openGrant(r)} data-testid={`grant-${r.company_code}`}>
                      <Gift size={12} className="mr-1"/> Grant Free
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openCA(r)} data-testid={`create-ca-${r.company_code}`}>
                      <UserPlus size={12} className="mr-1"/> Add Admin
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Grant Free Access */}
      <GrantFreeAccessDialog
        open={grantOpen}
        target={target}
        features={features}
        onClose={() => setGrantOpen(false)}
        onGranted={() => { setGrantOpen(false); load(); }}
      />

      {/* Create Company Admin */}
      <CreateCompanyAdminDialog
        open={caOpen}
        target={target}
        onClose={() => setCaOpen(false)}
        onCreated={() => { setCaOpen(false); load(); }}
      />
    </div>
  );
}

function Kpi({ label, value, accent, testid }) {
  const map = { emerald: "text-emerald-700", blue: "text-blue-700" };
  return (
    <Card className="p-4" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{label}</div>
      <div className={`text-2xl font-black tabular-nums mt-1 ${map[accent] || "text-slate-900"}`}>{value}</div>
    </Card>
  );
}


function GrantFreeAccessDialog({ open, target, features, onClose, onGranted }) {
  const [hrms, setHrms]         = useState(5);
  const [roleUser, setRoleUser] = useState(2);
  const [featureSet, setFS]     = useState(new Set());
  const [duration, setDuration] = useState(3);
  const [reason, setReason]     = useState("");
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (open) {
      setHrms(5); setRoleUser(2);
      // Pre-select ALL features by default so a single-click "give them
      // everything" grant just works. Admin can still un-tick individually.
      setFS(new Set((features || []).map((f) => f.code)));
      setDuration(3); setReason("");
    }
  }, [open, features]);

  const toggleFeature = (code) => setFS((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const selectAll     = () => setFS(new Set((features || []).map((f) => f.code)));
  const selectNone    = () => setFS(new Set());

  const submit = async () => {
    if (!target) return;
    if (!hrms && !roleUser && featureSet.size === 0) {
      return toast.error("Select at least 1 license or 1 feature");
    }
    setSaving(true);
    try {
      await api.post("/companies-admin/grant-free-access", {
        company_id: target.company_id,
        hrms_staff_qty: hrms,
        role_user_staff_qty: roleUser,
        feature_codes: Array.from(featureSet),
        duration_months: duration,
        reason: reason.trim(),
      });
      toast.success(`Free access granted to ${target.company_name}. Users must refresh their browser to see unlocked modules.`);
      onGranted?.();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="grant-free-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift size={18} className="text-purple-600"/> Grant Free Access</DialogTitle>
          <DialogDescription>
            Complimentary access to <span className="font-semibold text-slate-800">{target?.company_name}</span>
            <span className="ml-1 font-mono text-xs bg-slate-100 rounded px-1.5">{target?.company_code}</span>
            — no payment collected, entitlements activate immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>HRMS Staff Licenses</Label>
              <Input type="number" min={0} value={hrms} onChange={(e) => setHrms(Math.max(0, parseInt(e.target.value || "0", 10)))} data-testid="grant-hrms"/>
            </div>
            <div>
              <Label>Role/User Licenses</Label>
              <Input type="number" min={0} value={roleUser} onChange={(e) => setRoleUser(Math.max(0, parseInt(e.target.value || "0", 10)))} data-testid="grant-role"/>
            </div>
            <div>
              <Label>Duration (months)</Label>
              <Input type="number" min={1} max={60} value={duration} onChange={(e) => setDuration(Math.max(1, Math.min(60, parseInt(e.target.value || "1", 10))))} data-testid="grant-duration"/>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Feature Modules to Include <span className="text-slate-400 text-xs font-normal">({featureSet.size}/{features.length} selected)</span></Label>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={selectAll} data-testid="grant-select-all">Select All</Button>
                <Button size="sm" variant="ghost" onClick={selectNone} data-testid="grant-select-none">Clear</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
              {features.map((f) => {
                const on = featureSet.has(f.code);
                return (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => toggleFeature(f.code)}
                    data-testid={`grant-feature-${f.code}`}
                    className={`text-left border rounded p-2 text-sm transition ${on ? "border-purple-500 ring-1 ring-purple-100 bg-purple-50/40" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`w-4 h-4 rounded flex items-center justify-center mt-0.5 ${on ? "bg-purple-600" : "bg-slate-100 border border-slate-300"}`}>
                        {on && <Check size={11} className="text-white"/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800">{f.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{f.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Reason (optional, audit trail)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Strategic partnership, beta testing, refund credit" data-testid="grant-reason"/>
          </div>
          <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
            <b>Tip:</b> After granting, users of that company must <b>refresh their browser</b> (or log out/in) to see the newly unlocked modules in their sidebar.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-purple-600 hover:bg-purple-700" data-testid="grant-submit">
            {saving ? "Granting…" : "Grant Free Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function CreateCompanyAdminDialog({ open, target, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setEmail(""); setPassword(""); setMobile(""); }
  }, [open]);

  const submit = async () => {
    if (!target) return;
    if (!name.trim() || !email.trim() || password.length < 6) {
      return toast.error("Name, email and 6+ char password required");
    }
    setSaving(true);
    try {
      const r = await api.post("/companies-admin/create-company-admin", {
        company_id: target.company_id,
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
        mobile: mobile.trim() || null,
      });
      toast.success(`Company Admin created for ${target.company_name} (${r.data.company_code})`);
      onCreated?.();
    } catch (e) { toast.error(formatError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="create-ca-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus size={18}/> Create Company Admin</DialogTitle>
          <DialogDescription>
            Assigns the new Company Admin to <span className="font-semibold text-slate-800">{target?.company_name}</span>
            <span className="ml-1 font-mono text-xs bg-slate-100 rounded px-1.5">{target?.company_code}</span>.
            They will only see this company's data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Full Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ravi Kumar" data-testid="ca-name"/>
          </div>
          <div>
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@abc.com" data-testid="ca-email"/>
          </div>
          <div>
            <Label>Password * (min 6 chars)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Strong password" data-testid="ca-password"/>
          </div>
          <div>
            <Label>Mobile (optional)</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91…" data-testid="ca-mobile"/>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="ca-submit">{saving ? "Creating…" : "Create Company Admin"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
