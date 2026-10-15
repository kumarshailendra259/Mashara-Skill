import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Receipt, Upload, Trash2, Download, CheckCircle2, AlertTriangle,
  Eye, Copy, ChevronDown, ChevronRight, Search, Info,
} from "lucide-react";

const CATEGORIES = [
  { id: "bill", label: "Bill Details", items: [
    ["{{bill_no}}", "System Mess Bill number", "MB-26-0001"],
    ["{{invoice_no}}", "Supplier invoice number", "2025-26/2237"],
    ["{{invoice_date}}", "Supplier invoice date", "11-Oct-2025"],
    ["{{today}}", "Bill generation date", "15-Jun-2026"],
    ["{{total_amount}}", "Final payable amount", "6400.00"],
    ["{{total_words}}", "Amount in words", "INR Six Thousand Four Hundred Only"],
  ]},
  { id: "company", label: "Company / Buyer", items: [
    ["{{company_name}}", "Buyer company", "Mashara Enterprises"],
    ["{{company_address}}", "Company address", "Harmu Road, Ranchi"],
    ["{{company_gst}}", "Company GSTIN", "20FUTPK0747N1Z5"],
    ["{{company_pan}}", "Company PAN", "FUTPK0747N"],
    ["{{company_state}}", "State (from GSTIN)", "Jharkhand (20)"],
    ["{{center_name}}", "Center name", "Ranchi Center"],
  ]},
  { id: "supplier", label: "Supplier", items: [
    ["{{supplier_name}}", "Supplier name", "XPERT COMPUTER SOLUTION"],
    ["{{supplier_address}}", "Supplier address", "M9 Roshpa Tower, Ranchi"],
    ["{{supplier_gst}}", "Supplier GSTIN", "20AMZPA5673L1ZN"],
    ["{{supplier_pan}}", "Supplier PAN", "AMZPA5673L"],
    ["{{supplier_state}}", "Supplier state", "Jharkhand (20)"],
    ["{{supplier_phone}}", "Supplier phone", "9000000000"],
    ["{{supplier_email}}", "Supplier email", "sales@xpert.example"],
  ]},
  { id: "tax", label: "GST / Tax", items: [
    ["{{hsn_sac}}", "HSN/SAC summary", "91069000"],
    ["{{taxable_amount}}", "Taxable value", "5423.72"],
    ["{{cgst_rate}}", "CGST rate %", "9"],
    ["{{cgst_amount}}", "CGST amount", "488.13"],
    ["{{sgst_rate}}", "SGST rate %", "9"],
    ["{{sgst_amount}}", "SGST amount", "488.13"],
    ["{{igst_rate}}", "IGST rate %", "0"],
    ["{{igst_amount}}", "IGST amount", "0.00"],
    ["{{total_tax}}", "Total tax", "976.26"],
    ["{{round_off}}", "Round off", "0.02"],
    ["{{tax_amount_words}}", "Tax in words", "INR Nine Hundred Seventy Six and Twenty Six Paise Only"],
    ["{{tax_type}}", "CGST+SGST or IGST", "CGST+SGST"],
    ["{{total_qty}}", "Total quantity", "2"],
  ]},
  { id: "payment", label: "Payment", items: [
    ["{{payment_date}}", "Actual payment date", "12-Oct-2025"],
    ["{{payment_mode}}", "BANK / CASH / UPI", "BANK"],
    ["{{paid_by_name}}", "Who released payment", "Accounts Dept"],
  ]},
  { id: "bank", label: "Supplier Bank", items: [
    ["{{bank_name}}", "Supplier bank", "HDFC Bank"],
    ["{{bank_account}}", "Account number", "501000123456"],
    ["{{bank_ifsc}}", "IFSC code", "HDFC0000123"],
    ["{{bank_branch}}", "Branch", "Ranchi"],
  ]},
  { id: "items", label: "Item Loop", items: [
    ["{% for ln in lines %} … {% endfor %}", "Repeat per item (table row)", "loop"],
    ["{{ loop.index }}", "Continuous S.No across pages", "1, 2, 3…"],
    ["{{ ln.item_name }}", "Item description", "SECUREYE S-B8CB"],
    ["{{ ln.hsn_sac }}", "Item HSN/SAC", "91069000"],
    ["{{ ln.accepted_qty }} {{ ln.unit }}", "Qty + unit", "2 PCS"],
    ["{{ ln.unit_price }}", "Rate", "2711.86"],
    ["{{ ln.taxable }}", "Line taxable value", "5423.72"],
    ["{{ ln.tax_rate }}", "Line GST %", "18"],
    ["{{ ln.tax_amount }}", "Line tax amount", "976.26"],
    ["{{ ln.amount }}", "Line total", "6399.98"],
  ]},
  { id: "approvals", label: "Approval History", items: [
    ["{% for a in approvals %} … {% endfor %}", "Repeat per approval", "loop"],
    ["{{ a.level }}", "Approval level", "1"],
    ["{{ a.by_user_name }}", "Approver name", "Senior Manager"],
    ["{{ a.action }}", "Action", "approve"],
    ["{{ a.at }}", "Date", "2025-10-12"],
  ]},
];

export default function MessBillTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [file, setFile] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState({ bill: true, items: true });

  const load = () => api.get("/mess-bill-templates").then((r) => setTemplates(r.data || [])).catch(() => setTemplates([]));
  useEffect(() => {
    load();
    api.get("/entities/company").then((r) => setCompanies(r.data || [])).catch(() => setCompanies([]));
  }, []);

  const blobDownload = async (url, filename, newTab = false) => {
    try {
      const resp = await api.get(url, { responseType: "blob" });
      const objUrl = URL.createObjectURL(resp.data);
      if (newTab) { window.open(objUrl, "_blank"); return; }
      const a = document.createElement("a");
      a.href = objUrl; a.download = filename; a.click();
      URL.revokeObjectURL(objUrl);
    } catch (e) { toast.error(formatError(e)); }
  };

  const onPickFile = async (f) => {
    setFile(f); setValidation(null);
    if (!f) return;
    const form = new FormData();
    form.append("file", f);
    try {
      const { data } = await api.post("/mess-bill-templates/validate", form, { headers: { "Content-Type": "multipart/form-data" } });
      setValidation(data);
      if (data.ok && !data.warnings?.length) toast.success("Template is valid");
      else if (data.ok) toast.warning(`Valid, but ${data.warnings.length} warning(s)`);
      else toast.error("Template has errors — see details below");
    } catch (e) { toast.error(formatError(e)); }
  };

  const submit = async () => {
    if (!file) { toast.error("Choose a .docx file first"); return; }
    if (validation && !validation.ok) { toast.error("Fix template errors before uploading"); return; }
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const url = companyId ? `/mess-bill-templates?company_id=${companyId}` : "/mess-bill-templates";
      await api.post(url, form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Template uploaded — bills will render in this format");
      setFile(null); setCompanyId(""); setValidation(null);
      const inp = document.getElementById("mess-bill-tpl-file-input");
      if (inp) inp.value = "";
      load();
    } catch (e) { toast.error(formatError(e)); } finally { setBusy(false); }
  };

  const remove = async (tid) => {
    if (!window.confirm("Delete this template? Generated bills are unaffected.")) return;
    try { await api.delete(`/mess-bill-templates/${tid}`); toast.success("Template removed"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((c) => ({ ...c, items: c.items.filter(([k, d]) => (k + d).toLowerCase().includes(q)) })).filter((c) => c.items.length);
  }, [search]);

  return (
    <div className="space-y-6" data-testid="mess-bill-templates-tab">
      {/* Actions */}
      <div className="swiss-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Upload size={18} className="text-[var(--brand)]" />
            <div className="font-heading font-bold tracking-tight text-lg">Mess Bill Template</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-none gap-1" onClick={() => blobDownload("/mess-bill-templates/sample", "mess-bill-sample-template.docx")} data-testid="mess-bill-download-sample"><Download size={14} /> Download Sample</Button>
            <Button variant="outline" className="rounded-none gap-1" onClick={() => blobDownload("/mess-bill-templates/preview", "", true)} data-testid="mess-bill-preview"><Eye size={14} /> Preview Sample Bill</Button>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)] mb-4">
          Upload a <strong>.docx</strong> using the placeholders below. On final payment approval the bill auto-generates in this
          format with multi-item tables, continuous serial numbers and multi-page support. No template? A professional default is used.
          Start from <strong>Download Sample</strong> — it already has repeating headers and the item loop.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label className="overline">Scope — Company (optional)</Label>
            <Select value={companyId || "__global"} onValueChange={(v) => setCompanyId(v === "__global" ? "" : v)}>
              <SelectTrigger className="rounded-none" data-testid="mess-bill-tpl-company"><SelectValue placeholder="Global default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__global">Global — default fallback</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="overline">Template File (.docx)</Label>
            <input id="mess-bill-tpl-file-input" type="file" accept=".docx" onChange={(e) => onPickFile(e.target.files?.[0] || null)} className="block w-full text-sm border border-[var(--border)] rounded-none p-2 bg-white" data-testid="mess-bill-tpl-file" />
          </div>
        </div>
        {validation && (
          <div className="mt-3 border rounded-none p-3 text-sm" data-testid="mess-bill-validation" style={{ borderColor: validation.ok ? "#A7F3D0" : "#FCA5A5", background: validation.ok ? "#ECFDF5" : "#FEF2F2" }}>
            <div className="flex items-center gap-2 font-semibold">
              {validation.ok ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-rose-600" />}
              {validation.ok ? "Template is valid" : "Template has errors"}
            </div>
            {validation.errors?.map((e, i) => <div key={i} className="text-rose-700 mt-1">• {e}</div>)}
            {validation.warnings?.map((w, i) => <div key={i} className="text-amber-700 mt-1">⚠ {w}</div>)}
          </div>
        )}
        <div className="mt-4">
          <Button onClick={submit} disabled={!file || busy || (validation && !validation.ok)} className="rounded-none brand-btn gap-1" data-testid="mess-bill-tpl-upload">
            <Upload size={14} /> {busy ? "Uploading…" : "Upload Template"}
          </Button>
        </div>
      </div>

      {/* Placeholders */}
      <div className="swiss-card p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2"><Info size={18} className="text-[var(--brand)]" /><div className="font-heading font-bold tracking-tight text-lg">Available Placeholders</div></div>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search placeholders…" className="rounded-none pl-7 h-9 w-56" data-testid="mess-bill-ph-search" />
          </div>
        </div>
        <div className="space-y-2">
          {filtered.map((cat) => {
            const isOpen = search ? true : !!open[cat.id];
            return (
              <div key={cat.id} className="border border-[var(--border)]">
                <button onClick={() => setOpen((o) => ({ ...o, [cat.id]: !o[cat.id] }))} className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-sm font-semibold" data-testid={`ph-cat-${cat.id}`}>
                  <span className="flex items-center gap-2">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {cat.label}</span>
                  <span className="text-xs text-slate-400">{cat.items.length}</span>
                </button>
                {isOpen && (
                  <div className="divide-y divide-slate-100">
                    {cat.items.map(([key, desc, ex]) => (
                      <div key={key} className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-blue-50/40">
                        <code className="text-[11px] font-mono text-slate-800 shrink-0">{key}</code>
                        <span className="text-[11px] text-slate-500 flex-1 text-right truncate" title={`${desc} · e.g. ${ex}`}>{desc} <span className="text-slate-400">· {ex}</span></span>
                        <button onClick={() => { navigator.clipboard?.writeText(key); toast.success("Copied"); }} className="text-slate-400 hover:text-[var(--brand)] shrink-0" title="Copy"><Copy size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">No placeholders match “{search}”.</div>}
        </div>
      </div>

      {/* Uploaded templates */}
      <div className="swiss-card p-5">
        <div className="flex items-center gap-2 mb-3"><Receipt size={18} className="text-[var(--brand)]" /><div className="font-heading font-bold tracking-tight text-lg">Uploaded Templates</div></div>
        {templates.length === 0 ? (
          <div className="text-sm text-[var(--muted)] py-4">No templates uploaded — the default bill layout is in use.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)] overline">
              <th className="text-left p-2">Filename</th><th className="text-left p-2">Scope</th>
              <th className="text-left p-2">Uploaded By</th><th className="text-left p-2">Status</th><th className="text-right p-2">Action</th>
            </tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-2 font-medium">{t.filename}</td>
                  <td className="p-2">{t.company_name || <span className="text-[var(--muted)]">Global</span>}</td>
                  <td className="p-2">{t.uploaded_by_name || "—"}</td>
                  <td className="p-2">{t.is_active ? <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span> : <span className="text-xs px-2 py-0.5 bg-gray-100 text-[var(--muted)] border border-[var(--border)]">Superseded</span>}</td>
                  <td className="p-2 text-right flex justify-end gap-1">
                    <Button variant="outline" size="sm" className="rounded-none text-xs gap-1" onClick={() => blobDownload(`/mess-bill-templates/preview?template_id=${t.id}`, "", true)} data-testid={`mess-bill-tpl-preview-${t.id}`}><Eye size={12} /> Preview</Button>
                    <Button variant="outline" size="sm" className="rounded-none text-xs" onClick={() => remove(t.id)} data-testid={`mess-bill-tpl-delete-${t.id}`}><Trash2 size={12} /></Button>
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
