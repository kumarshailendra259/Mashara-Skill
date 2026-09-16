import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

const BLANK = {
  name: "", qp_code: "", sector: "", sub_sector: "", category: "1", nsqf_level: "",
  qp_hours: 0, training_hours: 0, cost_per_hour: 0, boarding_per_day: 0, default_days: 0,
  benefit: 0, description: "", effective_from: "", effective_to: "", active: true,
};

const NUM = ["qp_hours", "training_hours", "cost_per_hour", "boarding_per_day", "default_days", "benefit"];

export default function CourseMasterFormDialog({ open, initial, onClose, onSaved }) {
  const [f, setF] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(initial ? { ...BLANK, ...initial } : { ...BLANK });
  }, [open, initial]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!f.name?.trim()) { toast.error("Job Role / Course Name zaroori hai"); return; }
    setSaving(true);
    try {
      const payload = { ...f, name: f.name.trim() };
      NUM.forEach((k) => { payload[k] = Number(f[k]) || 0; });
      payload.default_hours = payload.training_hours; // legacy sync
      if (initial?.id) await api.patch(`/job-role-master/${initial.id}`, payload);
      else await api.post("/job-role-master", payload);
      toast.success(initial?.id ? "Course Master updated" : "Course Master created");
      onSaved && onSaved();
      onClose && onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save course master");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="course-master-form">
        <DialogHeader>
          <DialogTitle className="font-heading">{initial?.id ? "Edit Course / Job Role" : "Add Course / Job Role"}</DialogTitle>
          <DialogDescription>Central master — create once, reused everywhere (Work Order, Batch, Candidate, Reports).</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2"><Label className="overline">Job Role / Course Name *</Label>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="cm-inp-name" placeholder="e.g. Professional Makeup Artist" autoFocus /></div>
          <div><Label className="overline">QP Code</Label>
            <Input value={f.qp_code} onChange={(e) => set("qp_code", e.target.value)} data-testid="cm-inp-qp" placeholder="e.g. BWS/Q0101" /></div>
          <div><Label className="overline">Sector</Label>
            <Input value={f.sector} onChange={(e) => set("sector", e.target.value)} data-testid="cm-inp-sector" /></div>
          <div><Label className="overline">Sub Sector</Label>
            <Input value={f.sub_sector} onChange={(e) => set("sub_sector", e.target.value)} data-testid="cm-inp-subsector" /></div>
          <div><Label className="overline">Category</Label>
            <Input value={f.category} onChange={(e) => set("category", e.target.value)} data-testid="cm-inp-category" placeholder="1 / 2 / 3" /></div>
          <div><Label className="overline">NSQF Level</Label>
            <Input value={f.nsqf_level} onChange={(e) => set("nsqf_level", e.target.value)} data-testid="cm-inp-nsqf" placeholder="4 / 5 / 6" /></div>
          <div><Label className="overline">QP Hours</Label>
            <Input type="number" value={f.qp_hours} onChange={(e) => set("qp_hours", e.target.value)} data-testid="cm-inp-qphours" /></div>
          <div><Label className="overline">Training Hours</Label>
            <Input type="number" value={f.training_hours} onChange={(e) => set("training_hours", e.target.value)} data-testid="cm-inp-trainhours" /></div>
          <div><Label className="overline">Cost / Hour</Label>
            <Input type="number" value={f.cost_per_hour} onChange={(e) => set("cost_per_hour", e.target.value)} data-testid="cm-inp-cost" /></div>
          <div><Label className="overline">Board / Day</Label>
            <Input type="number" value={f.boarding_per_day} onChange={(e) => set("boarding_per_day", e.target.value)} data-testid="cm-inp-board" /></div>
          <div><Label className="overline">Default Days</Label>
            <Input type="number" value={f.default_days} onChange={(e) => set("default_days", e.target.value)} data-testid="cm-inp-days" /></div>
          <div><Label className="overline">Benefit / Stipend</Label>
            <Input type="number" value={f.benefit} onChange={(e) => set("benefit", e.target.value)} data-testid="cm-inp-benefit" /></div>
          <div><Label className="overline">Effective From</Label>
            <Input type="date" value={f.effective_from || ""} onChange={(e) => set("effective_from", e.target.value)} data-testid="cm-inp-efffrom" /></div>
          <div><Label className="overline">Effective To</Label>
            <Input type="date" value={f.effective_to || ""} onChange={(e) => set("effective_to", e.target.value)} data-testid="cm-inp-effto" /></div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={!!f.active} onCheckedChange={(v) => set("active", v)} data-testid="cm-inp-active" />
            <Label>{f.active ? "Active" : "Inactive"}</Label>
          </div>
        </div>
        <div><Label className="overline">Description</Label>
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} data-testid="cm-inp-desc" rows={2} /></div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="brand-btn" data-testid="cm-save-btn">{saving ? "Saving…" : (initial?.id ? "Update" : "Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
