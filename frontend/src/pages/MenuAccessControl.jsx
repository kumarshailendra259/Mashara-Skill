import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { usePerm } from "@/context/PermissionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShieldCheck, ChevronDown, ChevronRight, Plus, Trash2, RotateCcw, Save, Lock } from "lucide-react";
import { toast } from "sonner";

const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "print"];
const ACTION_LABEL = { view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", export: "Export", print: "Print" };

export default function MenuAccessControl() {
  const { reload: reloadPerms } = usePerm();
  const [menus, setMenus] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleKey, setRoleKey] = useState("");
  const [perms, setPerms] = useState({}); // menu_id -> {view,...}
  const [isAdminRole, setIsAdminRole] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [audit, setAudit] = useState([]);

  const tree = useMemo(() => {
    const tops = menus.filter((m) => !m.parent);
    return tops.map((t) => ({ ...t, children: menus.filter((m) => m.parent === t.id) }));
  }, [menus]);

  const loadBase = async () => {
    try {
      const [mRes, rRes] = await Promise.all([api.get("/rbac/menus"), api.get("/rbac/roles")]);
      setMenus(mRes.data || []);
      setRoles(rRes.data || []);
      if (!roleKey && (rRes.data || []).length) {
        const firstNonAdmin = (rRes.data || []).find((r) => r.key !== "admin") || rRes.data[0];
        setRoleKey(firstNonAdmin.key);
      }
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { loadBase(); /* eslint-disable-next-line */ }, []);

  const loadPerms = async (rk) => {
    if (!rk) return;
    setLoading(true);
    try {
      const r = await api.get(`/rbac/permissions/${rk}`);
      const map = {};
      (r.data?.permissions || []).forEach((row) => {
        map[row.menu_id] = {}; ACTIONS.forEach((a) => (map[row.menu_id][a] = !!row["can_" + a]));
      });
      setPerms(map);
      setIsAdminRole(!!r.data?.is_admin);
      setDirty(false);
      const a = await api.get(`/rbac/audit?role_key=${rk}`).catch(() => ({ data: [] }));
      setAudit(a.data || []);
    } catch (e) { toast.error(formatError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadPerms(roleKey); /* eslint-disable-next-line */ }, [roleKey]);

  const toggle = (menuId, action) => {
    if (isAdminRole) return;
    setPerms((p) => ({ ...p, [menuId]: { ...p[menuId], [action]: !p[menuId]?.[action] } }));
    setDirty(true);
  };
  const setAll = (val) => {
    if (isAdminRole) return;
    const next = {};
    menus.forEach((m) => { next[m.id] = {}; ACTIONS.forEach((a) => (next[m.id][a] = val)); });
    setPerms(next); setDirty(true);
  };
  const expandAll = () => { const e = {}; tree.forEach((t) => (e[t.id] = true)); setExpanded(e); };
  const collapseAll = () => setExpanded({});

  const doSave = async () => {
    setConfirmSave(false);
    try {
      const payload = { permissions: menus.map((m) => ({ menu_id: m.id, ...Object.fromEntries(ACTIONS.map((a) => ["can_" + a, !!perms[m.id]?.[a]])) })) };
      const r = await api.put(`/rbac/permissions/${roleKey}`, payload);
      toast.success(`Permissions saved (${r.data?.changed || 0} change${r.data?.changed === 1 ? "" : "s"})`);
      setDirty(false);
      loadPerms(roleKey);
      reloadPerms();
    } catch (e) { toast.error(formatError(e)); }
  };
  const doReset = async () => {
    if (!window.confirm("Reset this role to its default permissions? Custom changes will be removed.")) return;
    try { await api.post(`/rbac/permissions/${roleKey}/reset`); toast.success("Reset to default"); loadPerms(roleKey); reloadPerms(); }
    catch (e) { toast.error(formatError(e)); }
  };
  const createRole = async () => {
    if (!newRole.trim()) return;
    try {
      const r = await api.post("/rbac/roles", { label: newRole.trim() });
      toast.success(`Role "${r.data.label}" created (all permissions OFF)`);
      setNewRole(""); await loadBase(); setRoleKey(r.data.key);
    } catch (e) { toast.error(formatError(e)); }
  };
  const deleteRole = async () => {
    const role = roles.find((r) => r.key === roleKey);
    if (!role || role.is_system) return toast.error("System roles cannot be deleted");
    if (!window.confirm(`Delete role "${role.label}"?`)) return;
    try { await api.delete(`/rbac/roles/${roleKey}`); toast.success("Role deleted"); setRoleKey(""); await loadBase(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const selectedRole = roles.find((r) => r.key === roleKey);

  return (
    <div className="space-y-5" data-testid="menu-access-control-page">
      <div>
        <div className="overline">Organization Management · Roles &amp; Permissions</div>
        <h1 className="font-heading font-bold tracking-tight text-3xl mt-1 flex items-center gap-3">
          <ShieldCheck size={26} className="text-[var(--brand)]" /> Menu Access Control
        </h1>
        <div className="text-sm text-[var(--muted)] mt-1 max-w-3xl">
          Configure which menus &amp; actions each role can access. Backend enforces these (unauthorized API/URL → 403).
          Center-wise data isolation applies separately and always. <b>Admin</b> always retains full access.
        </div>
      </div>

      <Tabs defaultValue="matrix">
        <TabsList>
          <TabsTrigger value="matrix" data-testid="mac-tab-matrix">Permissions</TabsTrigger>
          <TabsTrigger value="audit" data-testid="mac-tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-4 pt-4">
          {/* Role toolbar */}
          <div className="swiss-card p-3 flex flex-wrap items-end gap-3">
            <div className="w-64">
              <Label className="overline">Select Role</Label>
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger data-testid="mac-role-select"><SelectValue placeholder="Select a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}{r.is_system ? "" : " (custom)"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-1">
              <div><Label className="overline">New Role</Label>
                <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. Auditor" className="h-9 w-40" data-testid="mac-new-role-input" /></div>
              <Button variant="outline" className="h-9" onClick={createRole} data-testid="mac-create-role"><Plus size={14} /> Add</Button>
            </div>
            {selectedRole && !selectedRole.is_system && (
              <Button variant="outline" className="h-9 hover:text-red-600" onClick={deleteRole} data-testid="mac-delete-role"><Trash2 size={14} /> Delete Role</Button>
            )}
            <div className="flex items-end gap-2 ml-auto">
              <Button variant="outline" className="h-9" onClick={() => setAll(true)} disabled={isAdminRole} data-testid="mac-select-all">Select All</Button>
              <Button variant="outline" className="h-9" onClick={() => setAll(false)} disabled={isAdminRole} data-testid="mac-clear-all">Clear All</Button>
              <Button variant="outline" className="h-9" onClick={expandAll}>Expand</Button>
              <Button variant="outline" className="h-9" onClick={collapseAll}>Collapse</Button>
              <Button variant="outline" className="h-9" onClick={doReset} disabled={isAdminRole} data-testid="mac-reset"><RotateCcw size={14} /> Reset</Button>
              <Button className="brand-btn h-9" onClick={() => setConfirmSave(true)} disabled={isAdminRole || !dirty} data-testid="mac-save"><Save size={14} /> Save</Button>
            </div>
          </div>

          {isAdminRole && (
            <div className="swiss-card p-3 flex items-center gap-2 text-sm bg-[var(--brand-soft)] text-[var(--brand)]" data-testid="mac-admin-note">
              <Lock size={15} /> Admin always has full access to every menu and cannot be restricted.
            </div>
          )}

          {/* Matrix */}
          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="[&>th]:p-2 [&>th]:overline [&>th]:text-[10px]">
                  <th className="text-left w-[38%]">Menu / Submenu</th>
                  {ACTIONS.map((a) => <th key={a} className="text-center">{ACTION_LABEL[a]}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="p-6 text-center text-[var(--muted)]">Loading…</td></tr>}
                {!loading && tree.map((top) => {
                  const open = !!expanded[top.id];
                  return (
                    <React.Fragment key={top.id}>
                      <tr className="border-t border-[var(--border)] bg-slate-50/60 [&>td]:p-2" data-testid={`mac-menu-${top.id}`}>
                        <td className="font-semibold">
                          <button className="inline-flex items-center gap-1" onClick={() => setExpanded((e) => ({ ...e, [top.id]: !open }))} disabled={!top.children.length}>
                            {top.children.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3.5 inline-block" />}
                            {top.label}
                          </button>
                        </td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="text-center">
                            <input type="checkbox" checked={!!perms[top.id]?.[a]} onChange={() => toggle(top.id, a)} disabled={isAdminRole}
                              className="h-4 w-4 accent-[var(--brand)] cursor-pointer" data-testid={`mac-chk-${top.id}-${a}`} />
                          </td>
                        ))}
                      </tr>
                      {open && top.children.map((ch) => (
                        <tr key={ch.id} className="border-t border-[var(--border)] [&>td]:p-2" data-testid={`mac-menu-${ch.id}`}>
                          <td className="pl-8 text-[var(--muted)]">{ch.label}</td>
                          {ACTIONS.map((a) => (
                            <td key={a} className="text-center">
                              <input type="checkbox" checked={!!perms[ch.id]?.[a]} onChange={() => toggle(ch.id, a)} disabled={isAdminRole}
                                className="h-4 w-4 accent-[var(--brand)] cursor-pointer" data-testid={`mac-chk-${ch.id}-${a}`} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          <div className="swiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr className="[&>th]:p-2 [&>th]:text-left [&>th]:overline [&>th]:text-[10px]">
                <th>When</th><th>By</th><th>Role</th><th>Changes</th>
              </tr></thead>
              <tbody>
                {audit.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-[var(--muted)]">No permission changes recorded for this role.</td></tr>}
                {audit.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--border)] [&>td]:p-2 align-top">
                    <td className="num whitespace-nowrap">{new Date(a.at).toLocaleString()}</td>
                    <td>{a.actor_name}</td>
                    <td className="font-mono">{a.role_key}</td>
                    <td>{(a.changes || []).map((c, i) => <div key={i}>{c.menu_id} · {c.action}: <b>{String(c.old)}</b> → <b>{String(c.new)}</b></div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Save confirm */}
      <Dialog open={confirmSave} onOpenChange={setConfirmSave}>
        <DialogContent data-testid="mac-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Save permissions for {selectedRole?.label}?</DialogTitle>
            <DialogDescription>This updates what users with this role can access. Backend will enforce it immediately.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSave(false)}>Cancel</Button>
            <Button className="brand-btn" onClick={doSave} data-testid="mac-confirm-save">Confirm &amp; Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
