import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Link2, Trash2, Plus, Users } from "lucide-react";
import BulkDeleteDialog from "@/components/BulkDeleteDialog";

export default function PartnerAssociations() {
  const { user } = useAuth();
  const canEdit = ["admin", "manager"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const [partners, setPartners] = useState([]);
  const [list, setList] = useState([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  // Bulk
  const [selected, setSelected] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const partnerName = (id) => partners.find((p) => p.id === id)?.name || id;

  const load = async () => {
    try {
      const [pr, lr] = await Promise.all([
        api.get("/entities/partner"),
        api.get("/partner-associations"),
      ]);
      setPartners(pr.data || []);
      setList(lr.data || []);
      setSelected(new Set());
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const create = async () => {
    if (!a || !b || a === b) {
      toast.error("Select two different partners");
      return;
    }
    setBusy(true);
    try {
      await api.post("/partner-associations", { partner_a_id: a, partner_b_id: b });
      toast.success("Association created");
      setA(""); setB("");
      load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Remove this association?")) return;
    try {
      await api.delete(`/partner-associations/${id}`);
      load();
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  const allIds = list.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));

  const bulkDelete = async () => {
    setBulkBusy(true);
    try {
      const res = await api.post("/partner-associations/bulk-delete", { ids: Array.from(selected) });
      toast.success(`${res.data?.deleted || 0} association(s) removed`);
      setBulkOpen(false);
      load();
    } catch (e) { toast.error(formatError(e)); }
    finally { setBulkBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="partner-associations-page">
      <div className="flex items-end justify-between border-b border-[var(--border)] pb-4">
        <div>
          <div className="overline text-[var(--brand)]">/ admin</div>
          <h1 className="font-heading text-3xl font-black tracking-tight mt-1">Partner Associations</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
            Pair partners who should be allowed to cross-approve each other&apos;s transactions.
            Same-project / same-center partners are already auto-associated — use this list for custom pairings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canDelete && selected.size > 0 && (
            <Button onClick={() => setBulkOpen(true)} variant="outline" className="rounded-none gap-1 border-[var(--danger)] text-[var(--danger)] hover:bg-red-50" data-testid="bulk-delete-assoc">
              <Trash2 size={14} /> Delete ({selected.size})
            </Button>
          )}
          <div className="text-xs text-[var(--muted)] inline-flex items-center gap-1">
            <Users size={12} /> {list.length} pair{list.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="border border-[var(--border)] p-4 bg-white" data-testid="add-association-card">
          <div className="overline mb-2">Add new pairing</div>
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">Partner A</div>
              <Select value={a} onValueChange={setA}>
                <SelectTrigger className="rounded-none" data-testid="assoc-partner-a"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)] mb-1">Partner B</div>
              <Select value={b} onValueChange={setB}>
                <SelectTrigger className="rounded-none" data-testid="assoc-partner-b"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {partners.filter((p) => p.id !== a).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={create} disabled={busy || !a || !b} className="brand-btn rounded-none h-10" data-testid="assoc-create-btn">
              <Plus size={14} className="mr-1" /> Add pairing
            </Button>
          </div>
        </div>
      )}

      <div className="border border-[var(--border)] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-[var(--muted)]">
            <tr>
              {canDelete && (
                <th className="p-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={allIds.length === 0} className="cursor-pointer" data-testid="select-all-assoc" />
                </th>
              )}
              <th className="text-left p-3">Partner A</th>
              <th className="text-left p-3"></th>
              <th className="text-left p-3">Partner B</th>
              <th className="text-left p-3">Added</th>
              {canEdit && <th className="text-right p-3">Action</th>}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={(canDelete ? 1 : 0) + (canEdit ? 5 : 4)} className="text-center p-8 text-[var(--muted)]">
                No custom pairings yet. Same-project / same-center partners can already cross-approve automatically.
              </td></tr>
            )}
            {list.map((row) => (
              <tr key={row.id} className="border-t border-[var(--border)]" data-testid={`assoc-row-${row.id}`}>
                {canDelete && (
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} className="cursor-pointer" data-testid={`select-assoc-${row.id}`} />
                  </td>
                )}
                <td className="p-3 font-medium">{partnerName(row.partner_a_id)}</td>
                <td className="p-3 text-[var(--muted)]"><Link2 size={14} /></td>
                <td className="p-3 font-medium">{partnerName(row.partner_b_id)}</td>
                <td className="p-3 text-xs text-[var(--muted)]">{new Date(row.created_at).toLocaleDateString()}</td>
                {canEdit && (
                  <td className="p-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => remove(row.id)}
                      className="rounded-none h-8 w-8 hover:text-[var(--danger)]"
                      data-testid={`assoc-delete-${row.id}`}>
                      <Trash2 size={14} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BulkDeleteDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        count={selected.size}
        itemLabel="associations"
        busy={bulkBusy}
        onConfirm={bulkDelete}
      />
    </div>
  );
}
