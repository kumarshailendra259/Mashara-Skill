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
  { key: "{{bill_no}}",         desc: "System bill number (e.g. MB-26-0001)" },
  { key: "{{invoice_no}}",      desc: "Supplier invoice number" },
  { key: "{{invoice_date}}",    desc: "Invoice date" },
  { key: "{{payment_date}}",    desc: "Payment date" },
  { key: "{{payment_mode}}",    desc: "e.g. BANK / CASH / UPI" },
  { key: "{{supplier_name}}",   desc: "Supplier / shop name" },
  { key: "{{center_name}}",     desc: "Center name" },
  { key: "{{company_name}}",    desc: "Company name" },
  { key: "{{company_address}}", desc: "Company address" },
  { key: "{{company_gst}}",     desc: "Company GST" },
  { key: "{{company_pan}}",     desc: "Company PAN" },
  { key: "{{total_amount}}",    desc: "Bill total ₹" },
  { key: "{{total_words}}",     desc: "Total in words" },
  { key: "{{paid_by_name}}",    desc: "Who released the payment" },
  { key: "{{today}}",           desc: "Date of bill generation" },
];

const LOOPS = [
  { key: "{% for ln in lines %} … {% endfor %}", desc: "Loop over items" },
  { key: "ln.item_name / ln.qty / ln.unit",       desc: "Item fields inside loop" },
  { key: "ln.unit_price / ln.accepted_qty / ln.accepted_cost", desc: "Rate & amounts" },
  { key: "{% for a in approvals %} … {% endfor %}", desc: "Loop over approval trail" },
  { key: "a.level / a.by_user_name / a.action / a.at", desc: "Approval fields" },
];

/** Mess Bill Template management — mirrors SalarySlipTemplatesTab. */
export default function MessBillTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [file, setFile] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get("/mess-bill-templates").then((r) => setTemplates(r.data || [])).catch(() => setTemplates([]));
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
      const url = companyId ? `/mess-bill-templates?company_id=${companyId}` : "/mess-bill-templates";
      await api.post(url, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Mess bill template uploaded — bills will render in this format");
      setFile(null); setCompanyId("");
      const inp = document.getElementById("mess-bill-tpl-file-input");
      if (inp) inp.value = "";
      load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tid) => {
    if (!window.confirm("Delete this template? Bills already generated are unaffected.")) return;
    try {
      await api.delete(`/mess-bill-templates/${tid}`);
      toast.success("Template removed");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div className="space-y-6" data-testid="mess-bill-templates-tab">
      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Upload size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Upload Mess Bill Template</div>
        </div>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload a <strong>.docx</strong> styled like your purchase bill with the placeholders below. When a mess
          payment is finally approved, the bill auto-generates in this format. If no template is uploaded, a
          professional default layout is used.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label className="overline">Scope — Company (optional)</Label>
            <Select value={companyId || "__global"} onValueChange={(v) => setCompanyId(v === "__global" ? "" : v)}>
              <SelectTrigger className="rounded-none" data-testid="mess-bill-tpl-company">
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
              id="mess-bill-tpl-file-input"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white"
              data-testid="mess-bill-tpl-file"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={submit} disabled={!file || busy} className="rounded-none brand-btn" data-testid="mess-bill-tpl-upload">
            {busy ? "Uploading…" : "Upload Template"}
          </Button>
        </div>
      </div>

      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Available Placeholders & Loops</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto">
          {PLACEHOLDERS.map((p) => (
            <div key={p.key} className="flex items-center justify-between border border-[var(--border)] px-3 py-1.5 bg-gray-50">
              <code className="text-xs font-mono">{p.key}</code>
              <span className="text-[11px] text-[var(--muted)] ml-3 truncate max-w-[55%]" title={p.desc}>{p.desc}</span>
            </div>
          ))}
          {LOOPS.map((p) => (
            <div key={p.key} className="flex items-center justify-between border border-[var(--border)] px-3 py-1.5 bg-blue-50/40">
              <code className="text-[11px] font-mono">{p.key}</code>
              <span className="text-[11px] text-[var(--muted)] ml-3 truncate max-w-[45%]" title={p.desc}>{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={18} className="text-[var(--brand)]" />
          <div className="font-heading font-bold tracking-tight text-lg">Uploaded Templates</div>
        </div>
        {templates.length === 0 ? (
          <div className="text-sm text-[var(--muted)] py-4">No templates uploaded — the default bill layout is in use.</div>
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
                      data-testid={`mess-bill-tpl-delete-${t.id}`}
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
