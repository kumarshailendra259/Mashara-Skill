import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Pencil, Power, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import CourseMasterFormDialog from "@/components/course/CourseMasterFormDialog";
import CourseMigrationTab from "@/components/course/CourseMigrationTab";

export default function CourseMaster() {
  const { user } = useAuth();
  const canManage = ["admin", "super_admin", "company_admin", "manager", "senior_manager"].includes(user?.role);
  const isAnyAdmin = ["admin", "super_admin", "company_admin"].includes(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/job-role-master", { params: { active_only: false, with_usage: true } });
      setRows(r.data || []);
    } catch { setRows([]); toast.error("Failed to load course master"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  const categories = [...new Set(rows.map((r) => String(r.category || "")).filter(Boolean))].sort();

  const filtered = rows.filter((r) => {
    if (sector !== "all" && r.sector !== sector) return false;
    if (category !== "all" && String(r.category || "") !== category) return false;
    if (status === "active" && !r.active) return false;
    if (status === "inactive" && r.active) return false;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      const hay = `${r.name} ${r.qp_code || ""} ${r.sector || ""} ${r.sub_sector || ""}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  const toggleActive = async (r) => {
    try {
      if (r.active) await api.delete(`/job-role-master/${r.id}`);
      else await api.patch(`/job-role-master/${r.id}`, { active: true });
      toast.success(r.active ? "Course deactivated" : "Course activated");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to update"); }
  };

  return (
    <div className="p-4 md:p-6 space-y-5" data-testid="course-master-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-[var(--brand-soft)] text-[var(--brand)] flex items-center justify-center"><GraduationCap size={18} /></div>
          <div>
            <h1 className="text-xl font-heading font-bold">Course / Job Role Master</h1>
            <p className="text-xs text-[var(--muted)]">Create once → select anywhere → auto-map everywhere. Single source of truth.</p>
          </div>
        </div>
        {canManage && (
          <Button className="brand-btn" onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="cm-add-btn"><Plus size={15} /> Add Course / Job Role</Button>
        )}
      </div>

      <Tabs defaultValue="courses" className="w-full">
        <TabsList data-testid="cm-tabs">
          <TabsTrigger value="courses" data-testid="cm-tab-courses">Courses</TabsTrigger>
          {isAnyAdmin && <TabsTrigger value="migration" data-testid="cm-tab-migration">Migration & Mapping</TabsTrigger>}
        </TabsList>
        <TabsContent value="courses" className="space-y-5 mt-4">
      <div className="swiss-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search role / QP / sector…" className="pl-8 h-9" data-testid="cm-search" />
        </div>
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger className="w-[160px] h-9" data-testid="cm-filter-sector"><SelectValue placeholder="Sector" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Sectors</SelectItem>{sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[130px] h-9" data-testid="cm-filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>Cat {c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[130px] h-9" data-testid="cm-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
        </Select>
      </div>

      <div className="swiss-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Role / Course</TableHead>
              <TableHead>QP Code</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead>Sub Sector</TableHead>
              <TableHead className="text-center">Cat</TableHead>
              <TableHead className="text-center">NSQF</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Cost/Hr</TableHead>
              <TableHead className="text-center">Usage</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={11} className="text-center py-8 text-[var(--muted)]">Loading…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center py-8 text-[var(--muted)]">No courses found. Add your first Course / Job Role.</TableCell></TableRow>}
            {filtered.map((r) => (
              <TableRow key={r.id} data-testid={`cm-row-${r.id}`}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="num text-xs">{r.qp_code || "—"}</TableCell>
                <TableCell className="text-xs">{r.sector || "—"}</TableCell>
                <TableCell className="text-xs">{r.sub_sector || "—"}</TableCell>
                <TableCell className="text-center text-xs">{r.category || "—"}</TableCell>
                <TableCell className="text-center text-xs">{r.nsqf_level || "—"}</TableCell>
                <TableCell className="text-right num text-xs">{r.training_hours || r.default_hours || 0}</TableCell>
                <TableCell className="text-right num text-xs">{r.cost_per_hour || 0}</TableCell>
                <TableCell className="text-center text-[10px] text-[var(--muted)] whitespace-nowrap">
                  {r.usage ? `${r.usage.work_orders} WO · ${r.usage.batches} B · ${r.usage.candidates} C` : "—"}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={r.active ? "default" : "secondary"} className={r.active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}>{r.active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {canManage && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(r); setFormOpen(true); }} title="Edit" data-testid={`cm-edit-${r.id}`}><Pencil size={13} /></Button>
                      <Button size="icon" variant="ghost" className={`h-7 w-7 ${r.active ? "hover:text-red-600" : "hover:text-emerald-600"}`} onClick={() => toggleActive(r)} title={r.active ? "Deactivate" : "Activate"} data-testid={`cm-toggle-${r.id}`}><Power size={13} /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
        </TabsContent>
        {isAnyAdmin && (
          <TabsContent value="migration" className="mt-4">
            <CourseMigrationTab masters={rows} onChanged={load} />
          </TabsContent>
        )}
      </Tabs>

      <CourseMasterFormDialog open={formOpen} initial={editing} onClose={() => setFormOpen(false)} onSaved={load} />
    </div>
  );
}
