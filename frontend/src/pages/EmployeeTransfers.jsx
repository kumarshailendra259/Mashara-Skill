import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
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
import { toast } from "sonner";
import { UserCog, Plus, RefreshCw, Trash2 } from "lucide-react";

// Phase-4 RBAC: Employee Transfer workflow.
// Allowed initiators: admin, hr, senior_manager, manager, center_manager.
// Chain (default): HR → Senior Manager → Admin. On final-approve staff.center_id updates.

const STATUS_BADGE = {
  pending:  "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-IN") : "—");

export default function EmployeeTransfers() {
  const { user } = useAuth();
  const [transfers, setTransfers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ staff_id: "", to_center_id: "", effective_date: "", reason: "", new_designation: "", new_reports_to_id: "" });

  const canRaise = ["admin", "hr", "senior_manager", "manager", "center_manager"].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [t, s, c] = await Promise.all([
        api.get("/employee-transfers"),
        api.get("/staff"),
        api.get("/entities/center"),
      ]);
      setTransfers(t.data || []);
      setStaff(s.data || []);
      setCenters(c.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const centerName = (id) => centers.find((c) => c.id === id)?.name || (id ? id.slice(0, 8) : "—");
  const staffName  = (id) => staff.find((s) => s.id === id)?.name  || (id ? id.slice(0, 8) : "—");

  const counts = useMemo(() => ({
    total: transfers.length,
    pending: transfers.filter((t) => t.status === "pending").length,
    approved: transfers.filter((t) => t.status === "approved").length,
    rejected: transfers.filter((t) => t.status === "rejected").length,
  }), [transfers]);

  const submit = async () => {
    if (!form.staff_id || !form.to_center_id || !form.effective_date || !form.reason || form.reason.length < 3) {
      toast.error("Staff, destination center, effective date and reason (min 3) are required");
      return;
    }
    const s = staff.find((x) => x.id === form.staff_id);
    if (s && s.center_id === form.to_center_id) {
      toast.error("Destination must differ from current center");
      return;
    }
    try {
      await api.post("/employee-transfers", {
        ...form,
        new_designation: form.new_designation || null,
        new_reports_to_id: form.new_reports_to_id || null,
      });
      toast.success("Transfer request raised — awaiting HR → Senior Manager → Admin");
      setOpen(false);
      setForm({ staff_id: "", to_center_id: "", effective_date: "", reason: "", new_designation: "", new_reports_to_id: "" });
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const removeT = async (id) => {
    if (!window.confirm("Delete this pending transfer request?")) return;
    try {
      await api.delete(`/employee-transfers/${id}`);
      toast.success("Deleted"); load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="employee-transfers-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Phase-4 RBAC</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2">
            <UserCog size={28} className="text-[var(--brand)]" />
            Employee Transfers
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Inter-center movement workflow: HR → Senior Manager → Admin approval.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} className="rounded-none gap-1" data-testid="btn-refresh-transfers">
            <RefreshCw size={14} /> Refresh
          </Button>
          {canRaise && (
            <Button onClick={() => setOpen(true)} className="brand-btn rounded-none gap-1" data-testid="btn-new-transfer">
              <Plus size={16} /> New Transfer
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total" value={counts.total} />
        <Kpi label="Pending" value={counts.pending} accent="text-amber-700" />
        <Kpi label="Approved" value={counts.approved} accent="value-positive" />
        <Kpi label="Rejected" value={counts.rejected} accent="value-negative" />
      </div>

      {loading ? (
        <div className="swiss-card p-12 text-center overline">Loading…</div>
      ) : transfers.length === 0 ? (
        <div className="swiss-card p-12 text-center">
          <UserCog size={48} className="text-[var(--muted)] mx-auto mb-3" />
          <div className="font-heading font-bold text-lg">No transfer requests yet</div>
          <div className="overline text-sm mt-1">Raise one to move an employee between centers.</div>
        </div>
      ) : (
        <div className="overflow-x-auto swiss-card">
          <table className="min-w-full text-sm" data-testid="transfers-table">
            <thead className="bg-gray-50">
              <tr>
                <Th>Employee</Th><Th>From → To</Th><Th>Effective</Th><Th>Reason</Th>
                <Th>Level</Th><Th>Status</Th><Th>By</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)]" data-testid={`et-row-${t.id}`}>
                  <Td>
                    <div className="font-medium">{t.staff_name || staffName(t.staff_id)}</div>
                    {t.new_designation && <div className="text-xs text-[var(--muted)]">→ {t.new_designation}</div>}
                  </Td>
                  <Td className="text-xs">
                    {centerName(t.from_center_id)} <span className="text-[var(--brand)] font-bold">→</span> {centerName(t.to_center_id)}
                  </Td>
                  <Td className="num text-xs">{fmtDate(t.effective_date)}</Td>
                  <Td className="text-xs max-w-[250px] truncate">{t.reason}</Td>
                  <Td>{t.current_level > 0
                    ? `L${t.current_level}${t.chain_snapshot?.length ? `/${t.chain_snapshot.length}` : ""}`
                    : "—"}</Td>
                  <Td>
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border ${STATUS_BADGE[t.status] || "bg-gray-100"}`}>
                      {(t.status || "").toUpperCase()}
                    </span>
                  </Td>
                  <Td className="text-xs">{t.created_by_name}<div className="text-[var(--muted)]">{fmtDate(t.created_at)}</div></Td>
                  <Td>
                    {t.status === "pending" && (user?.id === t.created_by || user?.role === "admin") && (
                      <Button variant="outline" size="sm" className="rounded-none h-7" onClick={() => removeT(t.id)} data-testid={`btn-del-et-${t.id}`}>
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-2xl" data-testid="transfer-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading">New Employee Transfer</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employee *">
              <Select value={form.staff_id} onValueChange={(v) => setForm({ ...form, staff_id: v })}>
                <SelectTrigger className="rounded-none" data-testid="sel-staff"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent className="rounded-none max-h-[300px]">
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {centerName(s.center_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Destination Center *">
              <Select value={form.to_center_id} onValueChange={(v) => setForm({ ...form, to_center_id: v })}>
                <SelectTrigger className="rounded-none" data-testid="sel-to-center"><SelectValue placeholder="Select center" /></SelectTrigger>
                <SelectContent className="rounded-none">
                  {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Effective Date *">
              <Input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} className="rounded-none" data-testid="inp-effective" />
            </Field>
            <Field label="New Designation (optional)">
              <Input value={form.new_designation} onChange={(e) => setForm({ ...form, new_designation: e.target.value })} className="rounded-none" />
            </Field>
            <div className="col-span-2">
              <Field label="Reason *">
                <Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Center-B is short-staffed; transferring trainer for upcoming batch." className="rounded-none" data-testid="inp-reason" />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">Cancel</Button>
            <Button onClick={submit} className="brand-btn rounded-none" data-testid="btn-submit-transfer">Raise Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Kpi = ({ label, value, accent }) => (
  <div className="swiss-card p-3">
    <div className="overline">{label}</div>
    <div className={`num font-bold text-xl mt-1 ${accent || ""}`}>{value}</div>
  </div>
);

const Field = ({ label, children }) => (
  <div>
    <Label className="overline text-xs">{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const Th = ({ children }) => <th className="text-left px-3 py-2 overline text-xs whitespace-nowrap">{children}</th>;
const Td = ({ children, className }) => <td className={`px-3 py-2 ${className || ""}`}>{children}</td>;
