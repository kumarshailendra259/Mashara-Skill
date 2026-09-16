import React, { useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, PlayCircle, Users, AlertTriangle, Link2, PlusCircle } from "lucide-react";
import { toast } from "sonner";

export default function CourseMigrationTab({ masters, onChanged }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [ambigMap, setAmbigMap] = useState({}); // "name|qp" -> master_id or "__create__"

  const sigKey = (it) => `${it.name}|${it.qp_code}`;

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get("/course-master/migration/preview"); setPreview(r.data); }
    catch { toast.error("Failed to load migration preview"); }
    finally { setLoading(false); }
  }, []);

  const apply = async () => {
    if (!window.confirm("Apply migration? New masters will be created for unmatched courses and all matching Work Orders/Batches will be linked. Historical course details stay unchanged.")) return;
    setApplying(true);
    try {
      const mappings = Object.entries(ambigMap).map(([k, master_id]) => {
        const [name, qp_code] = k.split("|");
        return { name, qp_code, master_id };
      });
      const r = await api.post("/course-master/migration/apply", { do_auto_link: true, do_create_new: true, mappings });
      toast.success(`Migration done — ${r.data.created_masters} masters created, ${r.data.wo_updated} WOs + ${r.data.batches_updated} batches linked`);
      setAmbigMap({});
      await loadPreview();
      onChanged && onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Migration failed"); }
    finally { setApplying(false); }
  };

  const backfill = async () => {
    if (!window.confirm("Backfill existing candidates with course info from their batch's linked master?")) return;
    try { const r = await api.post("/course-master/backfill-candidates"); toast.success(`${r.data.candidates_updated} candidates updated`); }
    catch (e) { toast.error(e?.response?.data?.detail || "Backfill failed"); }
  };

  const s = preview?.summary;

  return (
    <div className="space-y-4" data-testid="course-migration-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={loadPreview} disabled={loading} data-testid="mig-preview-btn"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {preview ? "Refresh Preview" : "Scan & Preview"}</Button>
        {preview && <Button className="brand-btn" onClick={apply} disabled={applying || (s.auto_link + s.create_new + Object.keys(ambigMap).length === 0)} data-testid="mig-apply-btn"><PlayCircle size={15} /> {applying ? "Applying…" : "Apply Migration"}</Button>}
        <Button variant="outline" onClick={backfill} data-testid="mig-backfill-btn"><Users size={14} /> Backfill Candidates</Button>
      </div>

      {!preview && <div className="swiss-card p-6 text-center text-sm text-[var(--muted)]">Click "Scan & Preview" to find existing Work Order / Batch courses that aren't yet linked to the Course Master.</div>}

      {preview && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="swiss-card p-3"><div className="overline text-[10px]">Total Signatures</div><div className="text-2xl font-bold num">{s.total_signatures}</div></div>
            <div className="swiss-card p-3"><div className="overline text-[10px] text-emerald-700">Auto-link</div><div className="text-2xl font-bold num text-emerald-700">{s.auto_link}</div></div>
            <div className="swiss-card p-3"><div className="overline text-[10px] text-blue-700">Create New</div><div className="text-2xl font-bold num text-blue-700">{s.create_new}</div></div>
            <div className="swiss-card p-3"><div className="overline text-[10px] text-amber-700">Ambiguous</div><div className="text-2xl font-bold num text-amber-700">{s.ambiguous}</div></div>
          </div>

          {preview.ambiguous.length > 0 && (
            <div className="swiss-card p-3">
              <div className="flex items-center gap-1 mb-2 text-amber-700 font-semibold text-sm"><AlertTriangle size={15} /> Ambiguous — pick a master (or create new)</div>
              <Table>
                <TableHeader><TableRow><TableHead>Course</TableHead><TableHead>QP</TableHead><TableHead className="text-center">Used In</TableHead><TableHead>Map To</TableHead></TableRow></TableHeader>
                <TableBody>
                  {preview.ambiguous.map((it) => (
                    <TableRow key={sigKey(it)} data-testid={`mig-ambig-${sigKey(it)}`}>
                      <TableCell className="font-medium">{it.name}</TableCell>
                      <TableCell className="num text-xs">{it.qp_code || "—"}</TableCell>
                      <TableCell className="text-center text-xs">{it.wo_count} WO · {it.batch_count} B</TableCell>
                      <TableCell>
                        <Select value={ambigMap[sigKey(it)] || ""} onValueChange={(v) => setAmbigMap((m) => ({ ...m, [sigKey(it)]: v }))}>
                          <SelectTrigger className="h-8 w-[240px]" data-testid={`mig-ambig-select-${sigKey(it)}`}><SelectValue placeholder="Select master…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__create__">➕ Create new master</SelectItem>
                            {(it.candidates || []).map((cnd) => <SelectItem key={cnd.id} value={cnd.id}>{cnd.name}{cnd.qp_code ? ` · ${cnd.qp_code}` : ""}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="swiss-card p-3">
              <div className="flex items-center gap-1 mb-2 text-emerald-700 font-semibold text-sm"><Link2 size={15} /> Auto-link ({preview.auto_link.length})</div>
              <div className="max-h-64 overflow-y-auto text-xs space-y-1">
                {preview.auto_link.length === 0 && <div className="text-[var(--muted)]">None</div>}
                {preview.auto_link.map((it) => (
                  <div key={sigKey(it)} className="flex items-center justify-between border-b border-[var(--border)] py-1">
                    <span>{it.name}{it.qp_code ? ` · ${it.qp_code}` : ""}</span>
                    <Badge variant="secondary" className="text-[10px]">→ {it.master_name}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div className="swiss-card p-3">
              <div className="flex items-center gap-1 mb-2 text-blue-700 font-semibold text-sm"><PlusCircle size={15} /> Will create new master ({preview.create_new.length})</div>
              <div className="max-h-64 overflow-y-auto text-xs space-y-1">
                {preview.create_new.length === 0 && <div className="text-[var(--muted)]">None</div>}
                {preview.create_new.map((it) => (
                  <div key={sigKey(it)} className="flex items-center justify-between border-b border-[var(--border)] py-1">
                    <span>{it.name}{it.qp_code ? ` · ${it.qp_code}` : ""}</span>
                    <span className="text-[var(--muted)]">{it.wo_count} WO · {it.batch_count} B</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
