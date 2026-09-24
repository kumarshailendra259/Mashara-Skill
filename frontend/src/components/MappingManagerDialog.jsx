import React, { useEffect, useState, useCallback } from "react";
import { api, formatError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Search, Network, Building2, X } from "lucide-react";

function StatusPill({ active }) {
  return active
    ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">Active</Badge>
    : <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 text-[10px]">Inactive</Badge>;
}

// Inline searchable picker (options: [{id,label,sub}])
function Picker({ options, exclude, placeholder, onPick, testid }) {
  const [q, setQ] = useState("");
  const filtered = options
    .filter((o) => !exclude.has(o.id))
    .filter((o) => !q || `${o.label} ${o.sub || ""}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 20);
  return (
    <div className="border border-[var(--border)] rounded-lg p-2 bg-slate-50" data-testid={testid}>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="rounded-lg h-8 pl-8 bg-white" />
      </div>
      <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
        {filtered.length === 0 ? <div className="text-xs text-slate-400 py-3 text-center">No matches</div> :
          filtered.map((o) => (
            <button key={o.id} onClick={() => onPick(o)} className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-white text-sm" data-testid={`pick-${o.id}`}>
              <span className="truncate">{o.label}{o.sub && <span className="text-[10px] text-slate-400 ml-1 font-mono">{o.sub}</span>}</span>
              <Plus size={13} className="text-[var(--brand)]" />
            </button>
          ))}
      </div>
    </div>
  );
}

export default function MappingManagerDialog({ open, onClose, mode, entity }) {
  // mode: "center" | "partner" | "staff"
  const [partners, setPartners] = useState([]);
  const [staff, setStaff] = useState([]);
  const [centersList, setCentersList] = useState([]);
  const [allPartners, setAllPartners] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [allCenters, setAllCenters] = useState([]);
  const [showPartnerPicker, setShowPartnerPicker] = useState(false);
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [showCenterPicker, setShowCenterPicker] = useState(false);
  const eid = entity?.id;

  const reload = useCallback(async () => {
    if (!open || !eid) return;
    try {
      if (mode === "center") {
        const [p, s] = await Promise.all([
          api.get(`/centers/${eid}/mapped-partners`),
          api.get(`/centers/${eid}/mapped-staff`),
        ]);
        setPartners(p.data || []); setStaff(s.data || []);
      } else if (mode === "partner") {
        const r = await api.get(`/partners/${eid}/mapped-centers`); setCentersList(r.data || []);
      } else if (mode === "staff") {
        const r = await api.get(`/staff/${eid}/mapped-centers`); setCentersList(r.data || []);
      }
    } catch (e) { toast.error(formatError(e)); }
  }, [open, eid, mode]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!open) return;
    if (mode === "center") {
      api.get("/entities/partner").then((r) => setAllPartners(r.data || [])).catch(() => {});
      api.get("/staff", { params: { limit: 3000 } }).then((r) => setAllStaff(r.data || [])).catch(() => {});
    } else {
      api.get("/entities/center").then((r) => setAllCenters(r.data || [])).catch(() => {});
    }
  }, [open, mode]);

  // ---- Center → Partner actions ----
  const addPartner = async (o) => {
    try { await api.post(`/centers/${eid}/mapped-partners`, { partner_id: o.id, cross_approval: true, active: true }); toast.success("Partner mapped"); setShowPartnerPicker(false); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const patchPartner = async (pid, patch) => {
    try { await api.patch(`/centers/${eid}/mapped-partners/${pid}`, patch); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const removePartner = async (pid) => {
    if (!window.confirm("Remove this partner mapping?")) return;
    try { await api.delete(`/centers/${eid}/mapped-partners/${pid}`); toast.success("Removed"); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };

  // ---- Center → Staff actions ----
  const addStaff = async (o) => {
    try { await api.post(`/centers/${eid}/mapped-staff`, { staff_id: o.id }); toast.success("Staff mapped"); setShowStaffPicker(false); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const removeStaff = async (sid) => {
    if (!window.confirm("Unmap this staff from the center?")) return;
    try { await api.delete(`/centers/${eid}/mapped-staff/${sid}`); toast.success("Removed"); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };

  // ---- Partner/Staff → Center actions ----
  const addCenterForPartner = async (o) => {
    try { await api.post(`/centers/${o.id}/mapped-partners`, { partner_id: eid, cross_approval: true, active: true }); toast.success("Center added"); setShowCenterPicker(false); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const removeCenterForPartner = async (cid) => {
    if (!window.confirm("Remove this center mapping?")) return;
    try { await api.delete(`/centers/${cid}/mapped-partners/${eid}`); toast.success("Removed"); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const addCenterForStaff = async (o) => {
    try { await api.post(`/centers/${o.id}/mapped-staff`, { staff_id: eid }); toast.success("Center added"); setShowCenterPicker(false); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const removeCenterForStaff = async (cid) => {
    if (!window.confirm("Unmap this center from the staff?")) return;
    try { await api.delete(`/centers/${cid}/mapped-staff/${eid}`); toast.success("Removed"); reload(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const partnerOpts = allPartners.map((p) => ({ id: p.id, label: p.name, sub: p.entity_uid }));
  const staffOpts = allStaff.map((s) => ({ id: s.id, label: s.name, sub: s.employee_code }));
  const centerOpts = allCenters.map((c) => ({ id: c.id, label: c.name, sub: c.entity_uid || c.center_code }));

  const Th = ({ children, className = "" }) => <th className={`text-left p-2 text-[10px] uppercase tracking-wide text-slate-500 ${className}`}>{children}</th>;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="rounded-xl max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="mapping-manager">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Network size={18} className="text-[var(--brand)]" /> Mappings — {entity?.name}
          </DialogTitle>
        </DialogHeader>

        {mode === "center" && (
          <Tabs defaultValue="partners">
            <TabsList className="w-full">
              <TabsTrigger value="partners" className="flex-1" data-testid="map-tab-partners">Mapped Partners</TabsTrigger>
              <TabsTrigger value="staff" className="flex-1" data-testid="map-tab-staff">Mapped Staff</TabsTrigger>
            </TabsList>

            <TabsContent value="partners" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" className="brand-btn rounded-lg gap-1" onClick={() => setShowPartnerPicker((v) => !v)} data-testid="btn-add-partner">
                  {showPartnerPicker ? <X size={14} /> : <Plus size={14} />} {showPartnerPicker ? "Close" : "Add Partner"}
                </Button>
              </div>
              {showPartnerPicker && <Picker options={partnerOpts} exclude={new Set(partners.map((p) => p.partner_id))} placeholder="Search partner by name or ID…" onPick={addPartner} testid="partner-picker" />}
              <div className="border border-[var(--border)] rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-[var(--border)]"><tr><Th>Partner ID</Th><Th>Name</Th><Th>Role</Th><Th>Status</Th><Th>Cross Approval</Th><Th className="text-right">Action</Th></tr></thead>
                  <tbody>
                    {partners.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-slate-400">No partners mapped.</td></tr> :
                      partners.map((p) => (
                        <tr key={p.partner_id} className="border-b border-slate-100" data-testid={`mapped-partner-${p.partner_id}`}>
                          <td className="p-2 font-mono text-xs text-[var(--brand)]">{p.entity_uid || "—"}</td>
                          <td className="p-2 font-medium">{p.name}</td>
                          <td className="p-2 text-slate-600">{p.role}</td>
                          <td className="p-2"><button onClick={() => patchPartner(p.partner_id, { active: !p.active })} title="Toggle active"><StatusPill active={p.active} /></button></td>
                          <td className="p-2"><Switch checked={p.cross_approval} onCheckedChange={(v) => patchPartner(p.partner_id, { cross_approval: v })} data-testid={`cross-approval-${p.partner_id}`} /></td>
                          <td className="p-2 text-right"><Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg hover:text-rose-600" onClick={() => removePartner(p.partner_id)} data-testid={`remove-partner-${p.partner_id}`}><Trash2 size={14} /></Button></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-400">Cross Approval ON = this partner can approve other partners' transactions at this center.</p>
            </TabsContent>

            <TabsContent value="staff" className="mt-4 space-y-3">
              <div className="flex justify-end">
                <Button size="sm" className="brand-btn rounded-lg gap-1" onClick={() => setShowStaffPicker((v) => !v)} data-testid="btn-add-staff">
                  {showStaffPicker ? <X size={14} /> : <Plus size={14} />} {showStaffPicker ? "Close" : "Add Staff"}
                </Button>
              </div>
              {showStaffPicker && <Picker options={staffOpts} exclude={new Set(staff.map((s) => s.staff_id))} placeholder="Search staff by name or code…" onPick={addStaff} testid="staff-picker" />}
              <div className="border border-[var(--border)] rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-[var(--border)]"><tr><Th>Emp ID</Th><Th>Name</Th><Th>Role</Th><Th>Status</Th><Th>Access</Th><Th className="text-right">Action</Th></tr></thead>
                  <tbody>
                    {staff.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-slate-400">No staff mapped.</td></tr> :
                      staff.map((s) => (
                        <tr key={s.staff_id} className="border-b border-slate-100" data-testid={`mapped-staff-${s.staff_id}`}>
                          <td className="p-2 font-mono text-xs text-[var(--brand)]">{s.employee_code || "—"}</td>
                          <td className="p-2 font-medium">{s.name} {s.is_primary && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[9px] ml-1">Primary</Badge>}</td>
                          <td className="p-2 text-slate-600">{s.role}</td>
                          <td className="p-2"><StatusPill active={s.status === "Active"} /></td>
                          <td className="p-2 text-slate-500 text-xs">{s.access_level}</td>
                          <td className="p-2 text-right">{s.is_primary ? <span className="text-[10px] text-slate-400">primary</span> : <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg hover:text-rose-600" onClick={() => removeStaff(s.staff_id)} data-testid={`remove-staff-${s.staff_id}`}><Trash2 size={14} /></Button>}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {(mode === "partner" || mode === "staff") && (
          <div className="mt-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="overline text-[var(--brand)] flex items-center gap-1.5"><Building2 size={14} /> Assigned Centers</div>
              <Button size="sm" className="brand-btn rounded-lg gap-1" onClick={() => setShowCenterPicker((v) => !v)} data-testid="btn-add-center">
                {showCenterPicker ? <X size={14} /> : <Plus size={14} />} {showCenterPicker ? "Close" : "Add Center"}
              </Button>
            </div>
            {showCenterPicker && <Picker options={centerOpts} exclude={new Set(centersList.map((c) => c.center_id))} placeholder="Search center by name or ID…" onPick={mode === "partner" ? addCenterForPartner : addCenterForStaff} testid="center-picker" />}
            <div className="border border-[var(--border)] rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-[var(--border)]"><tr>
                  <Th>Center Name</Th><Th>Center ID</Th><Th>Role</Th>
                  {mode === "partner" ? <Th>Cross Approval</Th> : <Th>Access</Th>}
                  <Th>Status</Th><Th className="text-right">Action</Th>
                </tr></thead>
                <tbody>
                  {centersList.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-slate-400">No centers assigned.</td></tr> :
                    centersList.map((c) => (
                      <tr key={c.center_id} className="border-b border-slate-100" data-testid={`assigned-center-${c.center_id}`}>
                        <td className="p-2 font-medium">{c.name} {c.is_primary && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[9px] ml-1">Primary</Badge>}</td>
                        <td className="p-2 font-mono text-xs text-[var(--brand)]">{c.entity_uid || "—"}</td>
                        <td className="p-2 text-slate-600">{c.role}</td>
                        {mode === "partner"
                          ? <td className="p-2">{c.cross_approval ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">Yes</Badge> : <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 text-[10px]">No</Badge>}</td>
                          : <td className="p-2 text-slate-500 text-xs">{c.access_level}</td>}
                        <td className="p-2"><StatusPill active={c.status !== "Inactive" && c.active !== false} /></td>
                        <td className="p-2 text-right">{c.is_primary ? <span className="text-[10px] text-slate-400">primary</span> :
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg hover:text-rose-600" onClick={() => (mode === "partner" ? removeCenterForPartner(c.center_id) : removeCenterForStaff(c.center_id))} data-testid={`remove-center-${c.center_id}`}><Trash2 size={14} /></Button>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
