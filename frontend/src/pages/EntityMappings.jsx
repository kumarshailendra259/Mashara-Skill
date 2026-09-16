import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Link2, Search, Network } from "lucide-react";
import { toast } from "sonner";

export default function EntityMappings() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total: 0, unmapped: 0 });
  const [q, setQ] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/entity-mappings", { params: { q: q || undefined, unmapped_only: unmappedOnly } });
      setRows(r.data.rows || []);
      setSummary({ total: r.data.total || 0, unmapped: r.data.unmapped || 0 });
    } catch { toast.error("Failed to load mappings"); }
    finally { setLoading(false); }
  }, [q, unmappedOnly]);
  useEffect(() => { const id = setTimeout(load, 300); return () => clearTimeout(id); }, [load]);

  const Cell = ({ name, uid }) => name
    ? <span className="text-[13px]">{name}<span className="block text-[10px] num text-[var(--muted)]">{uid || ""}</span></span>
    : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[9px]">Required</Badge>;

  return (
    <div className="p-4 md:p-6 space-y-5" data-testid="entity-mappings-page">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-md bg-[var(--brand-soft)] text-[var(--brand)] flex items-center justify-center"><Network size={18} /></div>
        <div>
          <h1 className="text-xl font-heading font-bold">Entity Relationship Mapping</h1>
          <p className="text-xs text-[var(--muted)]">Center → Partner → Project → Company. IDs are the permanent reference.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="swiss-card p-3"><div className="overline text-[10px]">Total Centers</div><div className="text-2xl font-bold num">{summary.total}</div></div>
        <div className="swiss-card p-3"><div className="overline text-[10px] text-amber-700">Mapping Required</div><div className="text-2xl font-bold num text-amber-700">{summary.unmapped}</div></div>
        <div className="swiss-card p-3"><div className="overline text-[10px] text-emerald-700">Fully Mapped</div><div className="text-2xl font-bold num text-emerald-700">{summary.total - summary.unmapped}</div></div>
      </div>

      <div className="swiss-card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any Unique ID or name…" className="pl-8 h-9" data-testid="em-search" />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={unmappedOnly} onCheckedChange={setUnmappedOnly} data-testid="em-unmapped-toggle" />
          <Label className="text-xs">Show only "Mapping Required"</Label>
        </div>
      </div>

      <div className="swiss-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Center</TableHead><TableHead>Partner</TableHead>
              <TableHead>Project</TableHead><TableHead>Company</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-center py-8 text-[var(--muted)]">Loading…</TableCell></TableRow>}
            {!loading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-[var(--muted)]">No centers found.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.center_id} data-testid={`em-row-${r.center_id}`}>
                <TableCell><Cell name={r.center_name} uid={r.center_uid} /></TableCell>
                <TableCell><Cell name={r.partner_name} uid={r.partner_uid} /></TableCell>
                <TableCell><Cell name={r.project_name} uid={r.project_uid} /></TableCell>
                <TableCell><Cell name={r.company_name} uid={r.company_uid} /></TableCell>
                <TableCell className="text-center">
                  {r.mapping_complete
                    ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]"><Link2 size={10} className="mr-1" />Linked</Badge>
                    : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">Mapping Required</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-[var(--muted)]">Reassign a mapping by editing the Center in Organization Management → Centers. All changes are recorded in the audit trail.</p>
    </div>
  );
}
