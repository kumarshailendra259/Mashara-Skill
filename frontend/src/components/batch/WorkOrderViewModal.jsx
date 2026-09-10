import React, { useState, useEffect } from "react";
import { inr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowLeft, Printer, Pencil, Trash2, Eye, FileText } from "lucide-react";

const STATUS_BADGE = {
  active: "badge-success", expired: "badge-warning", cancelled: "badge-danger", completed: "badge-info",
};

const Field = ({ label, value }) => (
  <div>
    <div className="overline text-[10px]">{label}</div>
    <div className="text-sm font-medium">{value || "—"}</div>
  </div>
);

function printWorkOrder(wo) {
  const rows = (wo.courses || []).map((c, i) => `
    <tr>
      <td>${i + 1}</td><td>${c.sector || ""}</td><td>${c.sub_sector || ""}</td><td>${c.course || ""}</td>
      <td>${c.qp_code || ""}</td><td>${c.category || ""}</td><td>${c.nsqf_level || ""}</td>
      <td style="text-align:right">${c.course_hours || 0}</td>
      <td style="text-align:right">₹${Number(c.cost_per_hour || 0).toLocaleString("en-IN")}</td>
      <td style="text-align:right">₹${Number(c.boarding_per_day || 0).toLocaleString("en-IN")}</td>
      <td style="text-align:right">${c.beneficiaries || 0}</td>
      <td style="text-align:right">₹${Number(c.total_boarding_cost || 0).toLocaleString("en-IN")}</td>
      <td style="text-align:right">₹${Number(c.total_classroom_fee || 0).toLocaleString("en-IN")}</td>
      <td style="text-align:right"><b>₹${Number(c.total_fee || 0).toLocaleString("en-IN")}</b></td>
    </tr>`).join("");
  const html = `<!doctype html><html><head><title>Work Order ${wo.wo_number}</title>
    <style>
      body{font-family:Inter,Arial,sans-serif;color:#111;padding:24px;font-size:12px}
      h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px;margin-top:8px}
      .lbl{text-transform:uppercase;font-size:9px;color:#666;letter-spacing:.05em}
      .val{font-weight:600;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}
      th,td{border:1px solid #bbb;padding:4px 6px} th{background:#f1f5f9;text-transform:uppercase;font-size:9px}
      .fin{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px}
      .fin .box{border:1px solid #ccc;padding:8px;border-radius:6px}
      .fin b{font-size:15px}
    </style></head><body>
    <h1>Work Order — ${wo.wo_number || ""}</h1>
    <div>${wo.project_name || ""} · ${wo.center_name || ""} · FY ${wo.fy || ""} · <b>${(wo.effective_status || "").toUpperCase()}</b></div>
    <h2>Basic Details</h2>
    <div class="grid">
      <div><div class="lbl">Scheme / Project</div><div class="val">${wo.scheme || wo.project_name || "—"}</div></div>
      <div><div class="lbl">Training Service Provider</div><div class="val">${wo.training_service_provider || "—"}</div></div>
      <div><div class="lbl">Name of Centre</div><div class="val">${wo.center_name || "—"}</div></div>
      <div><div class="lbl">District / Block</div><div class="val">${wo.district_block || "—"}</div></div>
      <div><div class="lbl">Centre Level</div><div class="val">${wo.centre_level || "—"}</div></div>
      <div><div class="lbl">Centre Type</div><div class="val">${wo.centre_type || "—"}</div></div>
      <div><div class="lbl">Nature of Training</div><div class="val">${wo.nature_of_training || "—"}</div></div>
      <div><div class="lbl">LWE District</div><div class="val">${wo.lwe_district || "—"}</div></div>
      <div><div class="lbl">Financial Year</div><div class="val">${wo.fy || "—"}</div></div>
      <div><div class="lbl">Work Order Number</div><div class="val">${wo.wo_number || "—"}</div></div>
      <div><div class="lbl">Issue Date</div><div class="val">${wo.issue_date || "—"}</div></div>
      <div><div class="lbl">Expiry Date</div><div class="val">${wo.expiry_date || "—"}</div></div>
      <div><div class="lbl">Status</div><div class="val">${(wo.effective_status || "").toUpperCase()}</div></div>
      <div><div class="lbl">LOI Number</div><div class="val">${wo.loi_number || "—"}</div></div>
    </div>
    <h2>Financial Details</h2>
    <div class="fin">
      <div class="box"><div class="lbl">Work Order Value</div><b>₹${Number(wo.work_order_value || 0).toLocaleString("en-IN")}</b></div>
      <div class="box"><div class="lbl">Total Training Fee</div><b>₹${Number(wo.total_training_fee || 0).toLocaleString("en-IN")}</b></div>
      <div class="box"><div class="lbl">Total Boarding Cost</div><b>₹${Number(wo.total_boarding_cost || 0).toLocaleString("en-IN")}</b></div>
      <div class="box"><div class="lbl">Grand Total</div><b>₹${Number(wo.grand_total || 0).toLocaleString("en-IN")}</b></div>
      <div class="box"><div class="lbl">PBG @ ${wo.pbg_percent || 0}%</div><b>₹${Number(wo.pbg_amount || 0).toLocaleString("en-IN")}</b></div>
    </div>
    <h2>Course Details</h2>
    <table><thead><tr>
      <th>S.No</th><th>Sector</th><th>Sub Sector</th><th>Course</th><th>QP Code</th><th>Cat</th><th>NSQF</th>
      <th>Hours</th><th>Cost/Hr</th><th>Board/Day</th><th>Benef.</th><th>Total Boarding</th><th>Total Classroom</th><th>Total Fee</th>
    </tr></thead><tbody>${rows}
      <tr><td colspan="13" style="text-align:right"><b>GRAND TOTAL</b></td><td style="text-align:right"><b>₹${Number(wo.grand_total || 0).toLocaleString("en-IN")}</b></td></tr>
    </tbody></table>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
}

export default function WorkOrderViewModal({ open, list, loading, onClose, onEdit, onDelete, canManage, canDelete }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (open) setSelected((list && list.length === 1) ? list[0] : null);
  }, [open, list]);

  const wo = selected;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="wo-view-modal">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><FileText size={18} /> View Work Order</DialogTitle>
          <DialogDescription>Complete work order details — basic information, financials and course breakdown.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading work order…</div>
        ) : (!list || list.length === 0) ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]" data-testid="wo-view-empty">
            No Work Order linked to this Project + Centre + Financial Year yet.
          </div>
        ) : (!wo) ? (
          /* Multiple work orders — list first */
          <div data-testid="wo-view-list">
            <div className="overline mb-2">Work Orders for this Centre ({list.length})</div>
            <div className="border border-[var(--border)] rounded-md overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
                    <th>Work Order No.</th><th>FY</th><th>Issue</th><th>Expiry</th>
                    <th className="text-right">Value</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((w) => (
                    <tr key={w.id} className="border-t border-[var(--border)] hover:bg-slate-50 [&>td]:p-2" data-testid={`wo-list-row-${w.id}`}>
                      <td className="font-semibold">{w.wo_number}</td>
                      <td className="num">{w.fy}</td>
                      <td className="num">{w.issue_date || "—"}</td>
                      <td className="num">{w.expiry_date || "—"}</td>
                      <td className="text-right num font-semibold">{inr(w.work_order_value)}</td>
                      <td><span className={`badge ${STATUS_BADGE[w.effective_status] || "badge-neutral"}`}>{w.effective_status}</span></td>
                      <td><Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSelected(w)} data-testid={`wo-list-view-${w.id}`}><Eye size={12} /> View</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Single WO detail */
          <div className="space-y-4" data-testid="wo-detail">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {list.length > 1 && (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setSelected(null)} data-testid="wo-back-list"><ArrowLeft size={13} /> Back</Button>
                )}
                <span className="font-heading font-bold text-lg">{wo.wo_number}</span>
                <span className={`badge ${STATUS_BADGE[wo.effective_status] || "badge-neutral"}`}>{wo.effective_status}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8" onClick={() => printWorkOrder(wo)} data-testid="wo-print-btn"><Printer size={13} /> Print / PDF</Button>
                {canManage && <Button size="sm" variant="outline" className="h-8" onClick={() => onEdit && onEdit(wo)} data-testid="wo-edit-btn"><Pencil size={13} /> Edit</Button>}
                {canDelete && <Button size="sm" variant="outline" className="h-8 hover:text-red-600" onClick={() => onDelete && onDelete(wo)} data-testid="wo-delete-btn"><Trash2 size={13} /> Delete</Button>}
              </div>
            </div>

            {/* Basic details */}
            <div className="swiss-card p-4">
              <div className="overline mb-3">Basic Details</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Scheme / Project" value={wo.scheme || wo.project_name} />
                <Field label="Training Service Provider" value={wo.training_service_provider} />
                <Field label="Name of Centre" value={wo.center_name} />
                <Field label="District / Block" value={wo.district_block} />
                <Field label="Centre Level" value={wo.centre_level} />
                <Field label="Centre Type" value={wo.centre_type} />
                <Field label="Nature of Training" value={wo.nature_of_training} />
                <Field label="LWE District" value={wo.lwe_district} />
                <Field label="Financial Year" value={wo.fy} />
                <Field label="Work Order Number" value={wo.wo_number} />
                <Field label="Issue Date" value={wo.issue_date} />
                <Field label="Expiry Date" value={wo.expiry_date} />
                <Field label="LOI Number" value={wo.loi_number} />
              </div>
            </div>

            {/* Financial details */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="swiss-card p-3"><div className="overline text-[10px]">Work Order Value</div><div className="num font-bold text-lg text-[var(--brand)]">{inr(wo.work_order_value)}</div></div>
              <div className="swiss-card p-3"><div className="overline text-[10px]">Total Training Fee</div><div className="num font-semibold text-emerald-700">{inr(wo.total_training_fee)}</div></div>
              <div className="swiss-card p-3"><div className="overline text-[10px]">Total Boarding Cost</div><div className="num font-semibold text-indigo-700">{inr(wo.total_boarding_cost)}</div></div>
              <div className="swiss-card p-3"><div className="overline text-[10px]">Grand Total</div><div className="num font-bold">{inr(wo.grand_total)}</div></div>
              <div className="swiss-card p-3"><div className="overline text-[10px]">PBG @ {wo.pbg_percent}%</div><div className="num font-semibold text-amber-700">{inr(wo.pbg_amount)}</div></div>
            </div>

            {/* Course table */}
            <div className="swiss-card overflow-x-auto">
              <div className="overline p-3 pb-0">Course Details</div>
              <table className="w-full text-[11px] min-w-[1000px] mt-2">
                <thead className="bg-slate-50">
                  <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[9px] [&>th]:whitespace-nowrap">
                    <th>S.No</th><th>Sector</th><th>Sub Sector</th><th>Course</th><th>QP Code</th><th>Cat</th><th>NSQF</th>
                    <th className="text-right">Hours</th><th className="text-right">Cost/Hr</th><th className="text-right">Board/Day</th>
                    <th className="text-right">Benef.</th><th className="text-right">Total Boarding</th><th className="text-right">Total Classroom</th><th className="text-right">Total Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {(wo.courses || []).map((c, i) => (
                    <tr key={i} className="border-t border-[var(--border)] [&>td]:p-2 [&>td]:whitespace-nowrap">
                      <td>{i + 1}</td><td>{c.sector || "—"}</td><td>{c.sub_sector || "—"}</td><td>{c.course || "—"}</td>
                      <td className="num">{c.qp_code || "—"}</td><td>{c.category || "—"}</td><td>{c.nsqf_level || "—"}</td>
                      <td className="text-right num">{c.course_hours}</td>
                      <td className="text-right num">{inr(c.cost_per_hour)}</td>
                      <td className="text-right num">{inr(c.boarding_per_day)}</td>
                      <td className="text-right num">{c.beneficiaries}</td>
                      <td className="text-right num">{inr(c.total_boarding_cost)}</td>
                      <td className="text-right num">{inr(c.total_classroom_fee)}</td>
                      <td className="text-right num font-semibold">{inr(c.total_fee)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--border)] bg-slate-50 font-bold">
                    <td colSpan={13} className="p-2 text-right overline">Grand Total</td>
                    <td className="p-2 text-right num text-[var(--brand)]">{inr(wo.grand_total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
