import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Receipt, Upload, Trash2, Info } from "lucide-react";

const PLACEHOLDERS = [
  { key: "{{staff_name}}",         desc: "Employee full name" },
  { key: "{{employee_code}}",      desc: "Auto-generated employee code" },
  { key: "{{designation}}",        desc: "Job title / role" },
  { key: "{{joining_date}}",       desc: "Original joining date" },
  { key: "{{email}}",              desc: "Employee email" },
  { key: "{{mobile}}",             desc: "Employee phone" },
  { key: "{{pan}}",                desc: "PAN number" },
  { key: "{{bank_name}}",          desc: "Bank name" },
  { key: "{{bank_account_no}}",    desc: "Bank account #" },
  { key: "{{ifsc}}",               desc: "IFSC code" },
  { key: "{{account_holder_name}}",desc: "Account holder name" },
  { key: "{{month_name}}",         desc: "e.g. 'July'" },
  { key: "{{year}}",               desc: "e.g. 2026" },
  { key: "{{month_year}}",         desc: "e.g. 'July 2026'" },
  { key: "{{days_present}}",       desc: "Days worked in the month" },
  { key: "{{working_days}}",       desc: "Effective working days" },
  { key: "{{basic}}",              desc: "Basic pay" },
  { key: "{{hra}}",                desc: "House Rent Allowance" },
  { key: "{{da}}",                 desc: "Dearness Allowance" },
  { key: "{{conveyance}}",         desc: "Conveyance" },
  { key: "{{bonus}}",              desc: "Bonus" },
  { key: "{{incentive}}",          desc: "Incentive" },
  { key: "{{overtime_pay}}",       desc: "Overtime pay" },
  { key: "{{other_earnings}}",     desc: "Other earnings" },
  { key: "{{reimbursements_paid}}",desc: "Reimbursements bundled into slip" },
  { key: "{{gross}}",              desc: "Total earnings before deductions" },
  { key: "{{pf_deduction}}",       desc: "PF deduction" },
  { key: "{{esi_deduction}}",      desc: "ESI deduction" },
  { key: "{{late_deduction}}",     desc: "Late-comer fine" },
  { key: "{{early_fine}}",         desc: "Early leaving fine" },
  { key: "{{advance}}",            desc: "Advance recovered" },
  { key: "{{loan_deduction}}",     desc: "Loan EMI recovered" },
  { key: "{{other_deductions_total}}", desc: "Sum of freeform 'other' deductions" },
  { key: "{{total_deductions}}",   desc: "Grand total deductions" },
  { key: "{{net}}",                desc: "Net take-home ₹" },
  { key: "{{net_words}}",          desc: "Amount in words (e.g. 'Rupees Thirteen Thousand Only')" },
  { key: "{{company_name}}",       desc: "Company name" },
  { key: "{{company_address}}",    desc: "Company address" },
  { key: "{{company_gst}}",        desc: "Company GST" },
  { key: "{{company_pan}}",        desc: "Company PAN" },
  { key: "{{center_name}}",        desc: "Assigned center name" },
  { key: "{{today}}",              desc: "Date of slip generation" },
];

/**
 * Salary Slip Template management — Phase B.
 * Mirrors OfferLetterTemplatesTab: upload DOCX per company (or global fallback),
 * only the newest template per company is active, deleting is idempotent.
 */
export default function SalarySlipTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [file, setFile] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get("/salary-slip-templates").then((r) => setTemplates(r.data || [])).catch(() => setTemplates([]));
  };

  useEffect(() => {
    load();
    api.get("/entities/company").then((r) => setCompanies(r.data || [])).catch(() => setCompanies([]));
  }, []);

  const submit = async () => {
    if (!file) { toast.error("Choose a .docx file first"); return; }
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const url = companyId ? `/salary-slip-templates?company_id=${companyId}` : "/salary-slip-templates";
      await api.post(url, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Salary slip template uploaded — HR can now generate slips per payroll row");
      setFile(null); setCompanyId("");
      const inp = document.getElementById("slip-tpl-file-input");
      if (inp) inp.value = "";
      load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tid) => {
    if (!window.confirm("Delete this template? Existing slips already generated are unaffected.")) return;
    try {
      await api.delete(`/salary-slip-templates/${tid}`);
      toast.success("Template removed");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="salary-slip-templates-tab">
      {/* Upload panel */}
      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Upload size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Upload Salary Slip Template</div>
        </div>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload a <strong>.docx</strong> file styled like your salary slip with placeholders shown below.
          HR can then click <em>Generate Slip</em> on each payroll row to render + preview a PDF, and toggle <em>Release</em> so
          the employee can see and download it from the mobile Staff App.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label className="overline">Scope — Company (optional)</Label>
            <Select value={companyId || "__global"} onValueChange={(v) => setCompanyId(v === "__global" ? "" : v)}>
              <SelectTrigger className="rounded-none" data-testid="slip-tpl-company">
                <SelectValue placeholder="Global (default fallback)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global">Global — default fallback</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-[10px] text-[var(--muted)] mt-1">Per-company templates override the global default.</div>
          </div>
          <div className="md:col-span-2">
            <Label className="overline">Template File (.docx)</Label>
            <input
              id="slip-tpl-file-input"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white"
              data-testid="slip-tpl-file"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={submit} disabled={!file || busy} className="rounded-none brand-btn" data-testid="slip-tpl-upload">
            {busy ? "Uploading…" : "Upload Template"}
          </Button>
        </div>
      </div>

      {/* Placeholder reference */}
      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Available Placeholders</div>
        </div>
        <p className="text-sm text-[var(--muted)] mb-3">
          Copy tokens exactly as shown (including <code>{"{{"}</code> and <code>{"}}"}</code>). Missing placeholders are silently ignored.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto">
          {PLACEHOLDERS.map((p) => (
            <div key={p.key} className="flex items-center justify-between border border-[var(--border)] px-3 py-1.5 bg-gray-50">
              <code className="text-xs font-mono">{p.key}</code>
              <span className="text-[11px] text-[var(--muted)] ml-3 truncate max-w-[60%]" title={p.desc}>{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Uploaded templates list */}
      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Uploaded Templates</div>
        </div>
        {templates.length === 0 ? (
          <div className="text-sm text-[var(--muted)] py-4">No templates uploaded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] overline">
                <th className="text-left p-2">Filename</th>
                <th className="text-left p-2">Scope</th>
                <th className="text-left p-2">Uploaded By</th>
                <th className="text-left p-2">Uploaded At</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-2 font-medium">{t.filename}</td>
                  <td className="p-2">{t.company_name || <span className="text-[var(--muted)]">Global</span>}</td>
                  <td className="p-2">{t.uploaded_by_name || "—"}</td>
                  <td className="p-2 num text-[11px]">{(t.uploaded_at || "").slice(0, 10)}</td>
                  <td className="p-2">
                    {t.is_active ? (
                      <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-[var(--muted)] border border-[var(--border)]">Superseded</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => remove(t.id)}
                      className="rounded-none text-xs"
                      data-testid={`slip-tpl-delete-${t.id}`}
                    >
                      <Trash2 size={12} className="mr-1" /> Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
