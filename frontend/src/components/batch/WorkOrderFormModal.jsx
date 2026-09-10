import React, { useMemo, useState, useEffect } from "react";
import { api } from "@/lib/api";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const FY_OPTIONS = ["2024-25", "2025-26", "2026-27", "2027-28", "2028-29"];
const EMPTY_COURSE = {
  sector: "", sub_sector: "", course: "", qp_code: "", category: "1", nsqf_level: "",
  course_hours: 0, cost_per_hour: 0, boarding_per_day: 0, boarding_days: 0, beneficiaries: 0,
};

const rowFee = (c) => {
  const classroom = (Number(c.course_hours) || 0) * (Number(c.cost_per_hour) || 0) * (Number(c.beneficiaries) || 0);
  const boarding = (Number(c.boarding_per_day) || 0) * (Number(c.boarding_days) || 0) * (Number(c.beneficiaries) || 0);
  return { classroom, boarding, total: classroom + boarding };
};

export default function WorkOrderFormModal({ open, initial, onClose, onSaved, projects, centers, companies, prefill }) {
  const blank = {
    project_id: "", center_id: "", company_id: "", fy: "2026-27",
    wo_number: "", loi_number: "", issue_date: "", expiry_date: "", status: "active",
    scheme: "", training_service_provider: "", nature_of_training: "STT",
    centre_level: "", centre_type: "", district_block: "", lwe_district: "",
    pbg_mode: "3", pbg_percent: 3, work_order_value_override: "",
    courses: [{ ...EMPTY_COURSE }], remarks: "",
  };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setF({ ...blank, ...initial, courses: (initial.courses?.length ? initial.courses : [{ ...EMPTY_COURSE }]),
        work_order_value_override: initial.work_order_value_override ?? "" });
    } else {
      setF({ ...blank, ...(prefill || {}) });
    }
    // eslint-disable-next-line
  }, [open, initial, prefill]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setCourse = (i, k, v) => setF((s) => ({ ...s, courses: s.courses.map((c, idx) => idx === i ? { ...c, [k]: v } : c) }));
  const addCourse = () => setF((s) => ({ ...s, courses: [...s.courses, { ...EMPTY_COURSE }] }));
  const delCourse = (i) => setF((s) => ({ ...s, courses: s.courses.filter((_, idx) => idx !== i) }));

  const totals = useMemo(() => {
    let classroom = 0, boarding = 0, benef = 0;
    (f.courses || []).forEach((c) => { const r = rowFee(c); classroom += r.classroom; boarding += r.boarding; benef += Number(c.beneficiaries) || 0; });
    const computed = classroom + boarding;
    const ov = Number(f.work_order_value_override) || 0;
    const value = ov > 0 ? ov : computed;
    const pbgPct = f.pbg_mode === "manual" ? (Number(f.pbg_percent) || 0) : Number(f.pbg_mode);
    const pbgAmt = value * pbgPct / 100;
    return { classroom, boarding, computed, value, pbgPct, pbgAmt, benef };
  }, [f]);

  const save = async () => {
    if (!f.project_id || !f.center_id || !f.fy || !f.wo_number?.trim()) {
      toast.error("Project, Centre, Financial Year aur Work Order Number zaroori hain");
      return;
    }
    setSaving(true);
    try {
      const pbgPct = f.pbg_mode === "manual" ? (Number(f.pbg_percent) || 0) : Number(f.pbg_mode);
      const payload = {
        ...f,
        pbg_percent: pbgPct,
        work_order_value_override: Number(f.work_order_value_override) || null,
        courses: (f.courses || []).map((c) => ({
          ...c,
          course_hours: Number(c.course_hours) || 0,
          cost_per_hour: Number(c.cost_per_hour) || 0,
          boarding_per_day: Number(c.boarding_per_day) || 0,
          boarding_days: Number(c.boarding_days) || 0,
          beneficiaries: Number(c.beneficiaries) || 0,
        })),
        company_id: f.company_id || null,
      };
      if (initial?.id) await api.patch(`/work-orders/${initial.id}`, payload);
      else await api.post("/work-orders", payload);
      toast.success(initial?.id ? "Work Order updated" : "Work Order created");
      onSaved && onSaved();
      onClose && onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save work order");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="wo-form-modal">
        <DialogHeader>
          <DialogTitle className="font-heading">{initial?.id ? "Edit Work Order" : "New Work Order"}</DialogTitle>
          <DialogDescription>Work Order is the source of truth for Work Order Value & PBG. Value auto-computes from the course rows below (editable).</DialogDescription>
        </DialogHeader>

        {/* Linkage + basic */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label className="overline">Project / Scheme *</Label>
            <Select value={f.project_id} onValueChange={(v) => set("project_id", v)}>
              <SelectTrigger data-testid="wo-inp-project"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="overline">Centre *</Label>
            <Select value={f.center_id} onValueChange={(v) => set("center_id", v)}>
              <SelectTrigger data-testid="wo-inp-center"><SelectValue placeholder="Select centre" /></SelectTrigger>
              <SelectContent>{centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="overline">Financial Year *</Label>
            <Select value={f.fy} onValueChange={(v) => set("fy", v)}>
              <SelectTrigger data-testid="wo-inp-fy"><SelectValue /></SelectTrigger>
              <SelectContent>{FY_OPTIONS.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="overline">Work Order Number *</Label>
            <Input value={f.wo_number} onChange={(e) => set("wo_number", e.target.value)} data-testid="wo-inp-number" placeholder="W00247/…" /></div>
          <div><Label className="overline">LOI Number</Label>
            <Input value={f.loi_number} onChange={(e) => set("loi_number", e.target.value)} data-testid="wo-inp-loi" placeholder="LOI00172/…" /></div>
          <div><Label className="overline">Status</Label>
            <Select value={f.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger data-testid="wo-inp-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="overline">Issue Date</Label>
            <Input type="date" value={f.issue_date} onChange={(e) => set("issue_date", e.target.value)} data-testid="wo-inp-issue" /></div>
          <div><Label className="overline">Expiry Date</Label>
            <Input type="date" value={f.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} data-testid="wo-inp-expiry" /></div>
          <div><Label className="overline">Training Service Provider</Label>
            <Input value={f.training_service_provider} onChange={(e) => set("training_service_provider", e.target.value)} /></div>
          <div><Label className="overline">Nature of Training</Label>
            <Input value={f.nature_of_training} onChange={(e) => set("nature_of_training", e.target.value)} placeholder="STT / RPL" /></div>
          <div><Label className="overline">Centre Level</Label>
            <Input value={f.centre_level} onChange={(e) => set("centre_level", e.target.value)} /></div>
          <div><Label className="overline">Centre Type</Label>
            <Input value={f.centre_type} onChange={(e) => set("centre_type", e.target.value)} /></div>
          <div><Label className="overline">District / Block</Label>
            <Input value={f.district_block} onChange={(e) => set("district_block", e.target.value)} /></div>
          <div><Label className="overline">LWE District</Label>
            <Input value={f.lwe_district} onChange={(e) => set("lwe_district", e.target.value)} placeholder="Yes / No / name" /></div>
          <div><Label className="overline">Company</Label>
            <Select value={f.company_id || "none"} onValueChange={(v) => set("company_id", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Any</SelectItem>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {/* Course details */}
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <Label className="overline">Course Details</Label>
            <Button size="sm" variant="outline" onClick={addCourse} className="h-7 text-[11px]" data-testid="wo-add-course"><Plus size={12} /> Add Course</Button>
          </div>
          <div className="overflow-x-auto border border-[var(--border)] rounded-md">
            <table className="w-full text-[11px] min-w-[1100px]">
              <thead className="bg-slate-50">
                <tr className="[&>th]:p-1.5 [&>th]:text-left [&>th]:overline [&>th]:text-[9px] [&>th]:whitespace-nowrap">
                  <th>Sector</th><th>Sub Sector</th><th>Course</th><th>QP Code</th><th>Cat</th><th>NSQF</th>
                  <th className="text-right">Hours</th><th className="text-right">Cost/Hr</th>
                  <th className="text-right">Board/Day</th><th className="text-right">Days</th><th className="text-right">Benef.</th>
                  <th className="text-right">Total Fee</th><th></th>
                </tr>
              </thead>
              <tbody>
                {f.courses.map((c, i) => {
                  const r = rowFee(c);
                  return (
                    <tr key={i} className="border-t border-[var(--border)] [&>td]:p-1" data-testid={`wo-course-row-${i}`}>
                      <td><Input value={c.sector} onChange={(e) => setCourse(i, "sector", e.target.value)} className="h-7 text-[11px]" /></td>
                      <td><Input value={c.sub_sector} onChange={(e) => setCourse(i, "sub_sector", e.target.value)} className="h-7 text-[11px]" /></td>
                      <td><Input value={c.course} onChange={(e) => setCourse(i, "course", e.target.value)} className="h-7 text-[11px] min-w-[120px]" /></td>
                      <td><Input value={c.qp_code} onChange={(e) => setCourse(i, "qp_code", e.target.value)} className="h-7 text-[11px]" /></td>
                      <td><Input value={c.category} onChange={(e) => setCourse(i, "category", e.target.value)} className="h-7 text-[11px] w-12" /></td>
                      <td><Input value={c.nsqf_level} onChange={(e) => setCourse(i, "nsqf_level", e.target.value)} className="h-7 text-[11px] w-12" /></td>
                      <td><Input type="number" value={c.course_hours} onChange={(e) => setCourse(i, "course_hours", e.target.value)} className="h-7 text-[11px] w-16 text-right" /></td>
                      <td><Input type="number" value={c.cost_per_hour} onChange={(e) => setCourse(i, "cost_per_hour", e.target.value)} className="h-7 text-[11px] w-20 text-right" /></td>
                      <td><Input type="number" value={c.boarding_per_day} onChange={(e) => setCourse(i, "boarding_per_day", e.target.value)} className="h-7 text-[11px] w-20 text-right" /></td>
                      <td><Input type="number" value={c.boarding_days} onChange={(e) => setCourse(i, "boarding_days", e.target.value)} className="h-7 text-[11px] w-14 text-right" /></td>
                      <td><Input type="number" value={c.beneficiaries} onChange={(e) => setCourse(i, "beneficiaries", e.target.value)} className="h-7 text-[11px] w-16 text-right" /></td>
                      <td className="text-right num font-semibold whitespace-nowrap">{inr(r.total)}</td>
                      <td><Button size="icon" variant="ghost" onClick={() => delCourse(i)} className="h-6 w-6 hover:text-red-600"><Trash2 size={12} /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Financial summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2">
          <div><Label className="overline">Total Training Fee</Label><div className="num font-semibold text-emerald-700">{inr(totals.classroom)}</div></div>
          <div><Label className="overline">Total Boarding</Label><div className="num font-semibold text-indigo-700">{inr(totals.boarding)}</div></div>
          <div><Label className="overline">Grand Total</Label><div className="num font-bold">{inr(totals.computed)}</div></div>
          <div>
            <Label className="overline">PBG %</Label>
            <Select value={f.pbg_mode} onValueChange={(v) => set("pbg_mode", v)}>
              <SelectTrigger data-testid="wo-inp-pbg-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3%</SelectItem><SelectItem value="5">5%</SelectItem>
                <SelectItem value="10">10%</SelectItem><SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            {f.pbg_mode === "manual" && (
              <Input type="number" value={f.pbg_percent} onChange={(e) => set("pbg_percent", e.target.value)} className="mt-1 h-8" placeholder="% value" data-testid="wo-inp-pbg-manual" />
            )}
          </div>
          <div><Label className="overline">PBG Amount</Label><div className="num font-semibold text-amber-700">{inr(totals.pbgAmt)}</div></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="overline">Work Order Value (override)</Label>
            <Input type="number" value={f.work_order_value_override} onChange={(e) => set("work_order_value_override", e.target.value)}
              placeholder={`Auto: ${inr(totals.computed)}`} data-testid="wo-inp-value-override" />
          </div>
          <div className="md:col-span-2">
            <Label className="overline">Remarks</Label>
            <Input value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
          </div>
        </div>
        <div className="text-xs text-[var(--muted)]">Effective Work Order Value: <b className="text-[var(--brand)] num">{inr(totals.value)}</b></div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="brand-btn" data-testid="wo-save-btn">{saving ? "Saving…" : (initial?.id ? "Update Work Order" : "Create Work Order")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
