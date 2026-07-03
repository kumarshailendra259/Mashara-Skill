import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Info } from "lucide-react";

const PLACEHOLDERS = [
  { key: "{{staff_name}}",     desc: "Full name of the staff" },
  { key: "{{designation}}",    desc: "Job title / role" },
  { key: "{{joining_date}}",   desc: "Effective joining date" },
  { key: "{{monthly_salary}}", desc: "Salary formatted like ₹ 25,000.00" },
  { key: "{{monthly_salary_words}}", desc: "e.g. 'Twenty Five Thousand Only Rupees'" },
  { key: "{{per_day_rate}}",   desc: "Per-day rate (₹)" },
  { key: "{{email}}",          desc: "Staff email (contact)" },
  { key: "{{mobile}}",         desc: "Staff phone" },
  { key: "{{address}}",        desc: "Home address" },
  { key: "{{login_email}}",    desc: "Portal login email (same as email)" },
  { key: "{{login_password}}", desc: "Auto-generated temp password" },
  { key: "{{company_name}}",   desc: "Company entity name" },
  { key: "{{company_address}}",desc: "Company registered address" },
  { key: "{{company_gst}}",    desc: "Company GST no." },
  { key: "{{center_name}}",    desc: "Assigned center name" },
  { key: "{{today}}",          desc: "Date of letter generation (03 July 2026)" },
];

/**
 * Manages per-company offer-letter DOCX templates.
 * - Admin/HR can upload a .docx with Jinja-style placeholders.
 * - Optionally scope a template to a specific company; else it acts as global default.
 * - Uploading a new template for the same company deactivates the previous one.
 */
export default function OfferLetterTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [file, setFile] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get("/offer-letter-templates").then((r) => setTemplates(r.data || [])).catch(() => setTemplates([]));
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
      const url = companyId ? `/offer-letter-templates?company_id=${companyId}` : "/offer-letter-templates";
      await api.post(url, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Template uploaded — new staff at this company will now receive offer letters automatically");
      setFile(null); setCompanyId("");
      const inp = document.getElementById("offer-tpl-file-input");
      if (inp) inp.value = "";
      load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tid) => {
    if (!window.confirm("Delete this template? Existing letters already sent are unaffected.")) return;
    try {
      await api.delete(`/offer-letter-templates/${tid}`);
      toast.success("Template removed");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="offer-letter-templates-tab">
      {/* Upload panel */}
      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Upload size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Upload Offer Letter Template</div>
        </div>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload a <strong>.docx</strong> file containing your company letterhead and the placeholders listed below.
          When a new staff is added at a center whose company matches this template, the system will render the letter,
          convert to PDF, save a copy, and email it to the staff automatically.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label className="overline">Scope — Company (optional)</Label>
            <Select value={companyId || "__global"} onValueChange={(v) => setCompanyId(v === "__global" ? "" : v)}>
              <SelectTrigger className="rounded-none" data-testid="offer-tpl-company">
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
              id="offer-tpl-file-input"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white"
              data-testid="offer-tpl-file"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button
            onClick={submit}
            disabled={!file || busy}
            className="rounded-none brand-btn"
            data-testid="offer-tpl-upload"
          >
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
          Copy these tokens into your DOCX exactly as shown (including the double curly braces).
          Any placeholder missing from your template is silently ignored — no need to include all of them.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
          <FileText size={18} className="text-[var(--brand)]" />
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
                      data-testid={`offer-tpl-delete-${t.id}`}
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
