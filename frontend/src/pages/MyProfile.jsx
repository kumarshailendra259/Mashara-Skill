import React, { useEffect, useState, useRef } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SubmitButton from "@/components/SubmitButton";
import { ShieldCheck, ShieldAlert, Upload as UploadIcon } from "lucide-react";

/**
 * My Profile — self-service page for staff.
 *
 * Lets the currently-signed-in staff:
 *   • Update mobile / address / photo
 *   • Submit their bank details (which HR must then verify via /staff/:sid/verify-bank)
 *
 * Fields explicitly excluded: role, salary, center, employee_code — those are HR-only.
 */
export default function MyProfile() {
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({});
  const fileRef = useRef(null);

  const load = () =>
    api.get("/me/staff-profile")
      .then((r) => {
        setStaff(r.data);
        setForm({
          mobile: r.data.mobile || "",
          address: r.data.address || "",
          bank_name: r.data.bank_name || "",
          bank_account_no: r.data.bank_account_no || "",
          ifsc: r.data.ifsc || "",
          account_holder_name: r.data.account_holder_name || "",
          upi_id: r.data.upi_id || "",
        });
      })
      .catch((e) => toast.error(formatError(e)))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const r = await api.put("/me/staff-profile", form);
      setStaff(r.data);
      toast.success("Profile saved. HR will verify your bank details.");
    } catch (e) { toast.error(formatError(e)); }
  };

  const uploadPhoto = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast.error("Photo must be under 3 MB"); return; }
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await api.post("/me/staff-profile/photo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setStaff((s) => ({ ...(s || {}), photo_url: r.data.photo_url }));
      toast.success("Photo uploaded");
    } catch (err) { toast.error(formatError(err)); }
  };

  if (loading) return <div className="p-6 text-sm text-[var(--muted)]">Loading…</div>;
  if (!staff) return null;

  return (
    <div className="max-w-3xl space-y-4" data-testid="my-profile-page">
      <div>
        <div className="overline">HRMS · SELF SERVICE</div>
        <h1 className="font-heading text-3xl font-bold">My Profile</h1>
      </div>

      {/* Identity + photo */}
      <div className="swiss-card p-5 flex items-center gap-4">
        <div className="w-20 h-20 border border-[var(--border)] flex-shrink-0 overflow-hidden">
          {staff.photo_url ? (
            <img src={staff.photo_url} alt={staff.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gray-100 flex items-center justify-center text-2xl font-bold text-[var(--muted)]">
              {(staff.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-heading text-xl font-bold">{staff.name}</div>
          <div className="text-sm text-[var(--muted)]">{staff.designation || "—"}</div>
          {staff.employee_code && (
            <div className="text-xs font-mono text-[var(--brand)] mt-0.5">{staff.employee_code}</div>
          )}
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/*" onChange={uploadPhoto} className="hidden" data-testid="upload-photo-input" />
          <Button variant="outline" className="rounded-none gap-2" onClick={() => fileRef.current?.click()} data-testid="upload-photo-btn">
            <UploadIcon size={14} /> {staff.photo_url ? "Change Photo" : "Add Photo"}
          </Button>
        </div>
      </div>

      {/* Contact */}
      <div className="swiss-card p-5 space-y-3">
        <div className="font-heading font-bold">Contact Details</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="overline">Mobile</Label>
            <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              className="rounded-none" data-testid="prof-mobile" />
          </div>
          <div className="sm:col-span-2">
            <Label className="overline">Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="rounded-none" data-testid="prof-address" />
          </div>
        </div>
      </div>

      {/* Bank Details */}
      <div className="swiss-card p-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="font-heading font-bold">Bank Details</div>
          {staff.bank_verified ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase border rounded-none bg-emerald-50 text-emerald-700 border-emerald-300" data-testid="bank-verified-badge">
              <ShieldCheck size={12} /> Verified
            </span>
          ) : (form.bank_account_no || staff.bank_account_no) ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase border rounded-none bg-amber-50 text-amber-700 border-amber-300" data-testid="bank-pending-badge">
              <ShieldAlert size={12} /> Pending HR Approval
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">Fill in and submit — HR will approve.</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="overline">Account Holder Name</Label>
            <Input value={form.account_holder_name} onChange={(e) => setForm({ ...form, account_holder_name: e.target.value })}
              className="rounded-none" data-testid="prof-holder" />
          </div>
          <div>
            <Label className="overline">Bank Name</Label>
            <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              className="rounded-none" data-testid="prof-bank-name" />
          </div>
          <div>
            <Label className="overline">Account Number</Label>
            <Input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })}
              className="rounded-none font-mono" data-testid="prof-account-no" />
          </div>
          <div>
            <Label className="overline">IFSC</Label>
            <Input value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
              className="rounded-none font-mono uppercase" data-testid="prof-ifsc" />
          </div>
          <div className="sm:col-span-2">
            <Label className="overline">UPI ID (optional)</Label>
            <Input value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
              className="rounded-none" data-testid="prof-upi" placeholder="yourname@paytm" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton onClick={save} className="brand-btn rounded-none" loadingLabel="Saving…" data-testid="prof-save">
          Save Changes
        </SubmitButton>
      </div>
    </div>
  );
}
