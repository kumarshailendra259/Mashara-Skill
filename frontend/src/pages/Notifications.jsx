import React, { useEffect, useMemo, useState } from "react";
import { api, formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MessageSquare, Send, RefreshCw, Phone, CheckCircle2, XCircle, Clock } from "lucide-react";

const STATUS_TONE = {
  queued:      { cls: "bg-slate-100 text-slate-700 border-slate-300", icon: Clock, label: "Queued" },
  sending:     { cls: "bg-blue-100 text-blue-700 border-blue-300", icon: Clock, label: "Sending" },
  sent:        { cls: "bg-indigo-100 text-indigo-700 border-indigo-300", icon: Clock, label: "Sent" },
  delivered:   { cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2, label: "Delivered" },
  read:        { cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2, label: "Read" },
  failed:      { cls: "bg-red-100 text-red-700 border-red-300", icon: XCircle, label: "Failed" },
  undelivered: { cls: "bg-red-100 text-red-700 border-red-300", icon: XCircle, label: "Undelivered" },
};

export default function Notifications() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ channel: "sms", recipient: "", body: "", event_type: "manual" });
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("all");

  const loadConfig = async () => {
    try { const r = await api.get("/notifications/config"); setConfig(r.data); }
    catch { /* admin-only — hide config panel for non-admin */ }
  };
  const loadLogs = async () => {
    try { const r = await api.get("/notifications/logs?limit=100"); setLogs(r.data || []); }
    catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { loadConfig(); loadLogs(); }, []);

  const send = async () => {
    if (!form.recipient.trim()) { toast.error("Recipient phone required"); return; }
    if (!form.body.trim()) { toast.error("Message body required"); return; }
    setBusy(true);
    try {
      const r = await api.post("/notifications/send", form);
      toast.success(`Sent — ${r.data.message_sid}`);
      setForm({ ...form, body: "" });
      loadLogs();
    } catch (e) {
      toast.error(formatError(e));
    } finally { setBusy(false); }
  };

  const filtered = useMemo(
    () => filter === "all" ? logs : logs.filter((l) => l.channel === filter),
    [logs, filter],
  );

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto" data-testid="notifications-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="overline">Communications</div>
          <h1 className="font-heading font-black tracking-tight text-3xl flex items-center gap-2">
            <MessageSquare size={28} className="text-[var(--brand)]" />
            SMS & WhatsApp Notifications
          </h1>
          <div className="text-sm text-[var(--muted)] mt-1">
            Send Twilio SMS / WhatsApp messages and track delivery status.
          </div>
        </div>
        <Button variant="outline" onClick={loadLogs} className="rounded-none gap-1" data-testid="btn-refresh-logs">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* Twilio config panel — admin only */}
      {config && (
        <div className="swiss-card p-4 border-l-4 border-purple-500" data-testid="notif-config">
          <div className="overline text-[10px] mb-2">Twilio Configuration</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><div className="overline text-[9px]">Status</div><div className="font-bold">{config.configured ? <span className="text-emerald-700">✓ Configured</span> : <span className="text-red-700">✗ Not Configured</span>}</div></div>
            <div><div className="overline text-[9px]">SMS From</div><div className="font-mono">{config.sms_from || "—"}</div></div>
            <div><div className="overline text-[9px]">WhatsApp From</div><div className="font-mono">{config.whatsapp_from || "—"}</div></div>
            <div><div className="overline text-[9px]">Webhook Base</div><div className="font-mono truncate" title={config.public_base}>{config.public_base || "—"}</div></div>
          </div>
          <div className="mt-2 text-[11px] text-[var(--muted)]">
            💡 WhatsApp Sandbox: recipients must first send <span className="font-mono bg-slate-100 px-1">join &lt;code&gt;</span> to <span className="font-mono">{config.whatsapp_from?.replace("whatsapp:", "")}</span> before they can receive messages.
          </div>
        </div>
      )}

      {/* Compose */}
      <div className="swiss-card p-5" data-testid="notif-compose">
        <div className="overline text-[10px] mb-3">Send a message</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Channel</Label>
            <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
              <SelectTrigger className="rounded-none" data-testid="channel-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">📱 SMS</SelectItem>
                <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Recipient phone</Label>
            <Input
              value={form.recipient}
              onChange={(e) => setForm({ ...form, recipient: e.target.value })}
              placeholder="e.g. 9876543210 or +919876543210"
              className="rounded-none"
              data-testid="recipient-input"
            />
          </div>
          <div>
            <Label className="text-xs">Event tag (audit)</Label>
            <Input
              value={form.event_type}
              onChange={(e) => setForm({ ...form, event_type: e.target.value })}
              placeholder="e.g. bg_expiry, payroll_paid"
              className="rounded-none"
              data-testid="event-input"
            />
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Message</Label>
          <Textarea
            rows={4}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="e.g. BG-1042 expires in 30 days on 2026-10-01. Please initiate renewal."
            className="rounded-none"
            data-testid="body-input"
          />
          <div className="text-[10px] text-[var(--muted)] mt-1">
            {form.body.length} chars · SMS Unicode split at 70 chars, GSM-7 at 160 chars
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={send} disabled={busy} className="brand-btn rounded-none gap-1" data-testid="btn-send">
            {busy ? "Sending…" : <><Send size={14} /> Send</>}
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {[
          { key: "all", label: "All" },
          { key: "sms", label: "SMS" },
          { key: "whatsapp", label: "WhatsApp" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            data-testid={`filter-${t.key}`}
            className={`px-4 py-2 text-sm border-b-2 transition-colors -mb-px ${
              filter === t.key
                ? "border-[var(--brand)] text-[var(--brand)] font-semibold"
                : "border-transparent hover:text-[var(--brand)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Logs */}
      {filtered.length === 0 ? (
        <div className="swiss-card p-12 text-center overline">No messages yet.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const tone = STATUS_TONE[l.status] || STATUS_TONE.queued;
            const Icon = tone.icon;
            return (
              <div key={l.id} className="swiss-card p-3 flex items-start gap-3 flex-wrap" data-testid={`log-row-${l.id}`}>
                <div className="p-2 bg-slate-50">
                  <Phone size={14} className="text-slate-700" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="overline text-[10px] font-bold">{l.channel?.toUpperCase()}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 border ${tone.cls} inline-flex items-center gap-1`}>
                      <Icon size={10} /> {tone.label}
                    </span>
                    {l.event_type && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 font-medium">{l.event_type}</span>}
                    <span className="font-mono text-xs text-slate-800">{l.recipient}</span>
                  </div>
                  <div className="text-sm text-slate-900 mt-1 whitespace-pre-wrap break-words">{l.body}</div>
                  <div className="text-[10px] text-[var(--muted)] mt-1 flex items-center gap-2 flex-wrap">
                    {l.message_sid && <span className="font-mono">SID: {l.message_sid.slice(0, 14)}…</span>}
                    {l.sent_by_name && <span>· by <b>{l.sent_by_name}</b></span>}
                    <span>· {new Date(l.created_at).toLocaleString("en-IN")}</span>
                    {l.error_code && <span className="text-red-700">· Err {l.error_code}: {l.error_message}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
