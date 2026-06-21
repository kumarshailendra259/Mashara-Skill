import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { useLang } from "@/context/LangContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import PrintButton from "@/components/PrintButton";

export default function Entities({ etype }) {
  const { t } = useLang();
  const { user } = useAuth();
  const canEdit = ["admin", "manager"].includes(user?.role);
  const canDelete = user?.role === "admin";
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", description: "" });

  const load = () => api.get(`/entities/${etype}`).then((r) => setItems(r.data));
  useEffect(() => { load(); }, [etype]);

  const openNew = () => { setEditing(null); setForm({ name: "", description: "" }); setOpen(true); };
  const openEdit = (it) => { setEditing(it); setForm({ name: it.name, description: it.description || "" }); setOpen(true); };

  const save = async () => {
    try {
      if (editing) await api.put(`/entities/${etype}/${editing.id}`, form);
      else await api.post(`/entities/${etype}`, form);
      setOpen(false);
      load();
      toast.success("Saved");
    } catch (e) { toast.error(formatError(e)); }
  };

  const remove = async (it) => {
    if (!window.confirm(t("confirm_delete"))) return;
    try { await api.delete(`/entities/${etype}/${it.id}`); load(); toast.success("Deleted"); }
    catch (e) { toast.error(formatError(e)); }
  };

  const titleKey = etype + "s"; // companies, partners, centers, projects

  return (
    <div className="space-y-5" data-testid={`entities-${etype}-page`}>
      <div className="flex justify-between items-end gap-3">
        <div>
          <div className="overline">{t("entities") || t(titleKey)}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t(titleKey)}</h1>
        </div>
        <div className="flex gap-2">
          <PrintButton />
          {canEdit && (
            <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="brand-btn rounded-none gap-2" data-testid={`btn-new-${etype}`}>
                <Plus size={16} /> {t("add")}
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none">
              <DialogHeader>
                <DialogTitle className="font-heading tracking-tight">
                  {editing ? t("edit") : t("add")} — {t(etype)}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>{t("name")}</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-none" data-testid="entity-name" />
                </div>
                <div>
                  <Label>{t("description")}</Label>
                  <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-none" rows={3} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} className="rounded-none">{t("cancel")}</Button>
                <Button onClick={save} className="brand-btn rounded-none" data-testid="entity-save">{t("save")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      <div className="swiss-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] overline bg-gray-50">
              <th className="text-left p-3">{t("name")}</th>
              <th className="text-left p-3">{t("description")}</th>
              {canEdit && <th className="p-3 w-32 text-right">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-8 overline">{t("no_data")}</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-b border-[var(--border)] hover:bg-gray-50">
                <td className="p-3 font-medium">{it.name}</td>
                <td className="p-3 text-[var(--muted)]">{it.description || "—"}</td>
                {canEdit && (
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(it)} className="rounded-none h-8 w-8" data-testid={`edit-${it.id}`}><Pencil size={14} /></Button>
                      {canDelete && <Button size="icon" variant="ghost" onClick={() => remove(it)} className="rounded-none h-8 w-8 hover:text-[var(--danger)]" data-testid={`delete-${it.id}`}><Trash2 size={14} /></Button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
