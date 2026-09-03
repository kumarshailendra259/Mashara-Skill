import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Building2, Plus, Trash2, MapPin } from "lucide-react";

const MEMBER_ROLES = [
  "company_admin", "manager", "senior_manager", "center_manager", "center_staff",
  "accountant", "hr", "partner", "reporting_authority", "center_partner", "viewer",
];

export default function MembershipsDialog({ open, onClose, userId, userName, isSuperAdmin }) {
  const [rows, setRows] = useState([]);       // [{company_id, company_name, company_code, role, center_ids}]
  const [allCompanies, setAllCompanies] = useState([]);
  const [centersByCompany, setCentersByCompany] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add-form state
  const [newCompany, setNewCompany] = useState("");
  const [newRole, setNewRole] = useState("manager");

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    Promise.all([
      api.get(`/users/${userId}/memberships`),
      api.get("/auth/my-companies"),
    ]).then(([m, c]) => {
      setRows(m.data.memberships || []);
      setAllCompanies(c.data.companies || []);
    }).catch((e) => toast.error(formatError(e)))
      .finally(() => setLoading(false));
  }, [open, userId]);

  const loadCenters = async (companyId) => {
    if (centersByCompany[companyId]) return;
    try {
      const { data } = await api.get(`/centers?company_id=${companyId}`);
      setCentersByCompany((s) => ({ ...s, [companyId]: data || [] }));
    } catch { setCentersByCompany((s) => ({ ...s, [companyId]: [] })); }
  };

  useEffect(() => { rows.forEach((r) => loadCenters(r.company_id)); /* eslint-disable-next-line */ }, [rows]);

  const addMembership = () => {
    if (!newCompany) { toast.error("Pick a company"); return; }
    if (rows.some((r) => r.company_id === newCompany)) { toast.error("Company already added"); return; }
    const comp = allCompanies.find((c) => c.id === newCompany);
    setRows((s) => [...s, {
      company_id: newCompany, company_name: comp?.name, company_code: comp?.company_code,
      role: newRole, center_ids: [],
    }]);
    loadCenters(newCompany);
    setNewCompany("");
  };

  const removeRow = (companyId) => setRows((s) => s.filter((r) => r.company_id !== companyId));
  const setRowRole = (companyId, role) => setRows((s) => s.map((r) => r.company_id === companyId ? { ...r, role } : r));
  const toggleCenter = (companyId, centerId) => setRows((s) => s.map((r) => {
    if (r.company_id !== companyId) return r;
    const has = r.center_ids.includes(centerId);
    return { ...r, center_ids: has ? r.center_ids.filter((x) => x !== centerId) : [...r.center_ids, centerId] };
  }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/users/${userId}/memberships`, {
        memberships: rows.map((r) => ({ company_id: r.company_id, role: r.role, center_ids: r.center_ids })),
      });
      toast.success("Memberships saved");
      onClose(true);
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setSaving(false);
    }
  };

  const availableToAdd = allCompanies.filter((c) => !rows.some((r) => r.company_id === c.id));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(false); }}>
      <DialogContent className="rounded-none max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-tight flex items-center gap-2">
            <Building2 size={16} /> Companies &amp; Centers — {userName}
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-[var(--muted)]">
          Assign this user to one or more companies. Role &amp; centers can differ per company.
          The user logs in once and switches companies after login.
        </div>

        {loading ? (
          <div className="py-8 text-center overline">Loading…</div>
        ) : (
          <div className="space-y-3" data-testid="memberships-list">
            {rows.length === 0 && (
              <div className="py-6 text-center text-sm text-[var(--muted)]">No company memberships yet.</div>
            )}
            {rows.map((r) => {
              const centers = centersByCompany[r.company_id] || [];
              return (
                <div key={r.company_id} className="border border-gray-200 p-3" data-testid={`membership-${r.company_id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{r.company_name}</div>
                      <div className="text-[10px] font-mono text-[var(--muted)]">{r.company_code}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={r.role} onValueChange={(v) => setRowRole(r.company_id, v)}>
                        <SelectTrigger className="rounded-none h-8 w-40" data-testid={`membership-role-${r.company_id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MEMBER_ROLES.filter((role) => isSuperAdmin || role !== "company_admin" || true).map((role) => (
                            <SelectItem key={role} value={role}>{role}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="rounded-none h-8 w-8 text-red-600" onClick={() => removeRow(r.company_id)} data-testid={`membership-remove-${r.company_id}`}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] flex items-center gap-1 mb-1">
                      <MapPin size={11} /> Centers ({r.center_ids.length} selected)
                    </div>
                    {centers.length === 0 ? (
                      <div className="text-xs text-[var(--muted)]">No centers in this company.</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                        {centers.map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer p-1 hover:bg-gray-50">
                            <Checkbox checked={r.center_ids.includes(c.id)} onCheckedChange={() => toggleCenter(r.company_id, c.id)} data-testid={`membership-center-${r.company_id}-${c.id}`} />
                            <span className="font-mono text-[10px] text-[var(--brand)]">{c.center_code}</span>
                            <span className="truncate">{c.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Add membership row */}
            {availableToAdd.length > 0 && (
              <div className="border border-dashed border-gray-300 p-3 flex flex-wrap items-end gap-2" data-testid="add-membership-row">
                <div className="min-w-[200px] flex-1">
                  <Label className="text-xs">Add Company</Label>
                  <Select value={newCompany} onValueChange={setNewCompany}>
                    <SelectTrigger className="rounded-none mt-1" data-testid="add-membership-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {availableToAdd.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.company_code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[140px]">
                  <Label className="text-xs">Role</Label>
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger className="rounded-none mt-1" data-testid="add-membership-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MEMBER_ROLES.map((role) => (<SelectItem key={role} value={role}>{role}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="rounded-none gap-1" onClick={addMembership} data-testid="add-membership-btn">
                  <Plus size={14} /> Add
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="rounded-none" onClick={() => onClose(false)}>Cancel</Button>
          <Button className="rounded-none" onClick={save} disabled={saving} data-testid="save-memberships-btn">
            {saving ? "Saving…" : "Save Memberships"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
