import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Building2, ChevronRight, LogOut, ShieldCheck } from "lucide-react";

const ROLE_LABELS = {
  admin: "Super Admin", super_admin: "Super Admin", company_admin: "Company Admin",
  manager: "Manager", senior_manager: "Senior Manager", center_manager: "Center Manager",
  center_staff: "Center Staff", partner: "Partner", accountant: "Accountant", hr: "HR",
  viewer: "Viewer", reporting_authority: "Reporting Authority", center_partner: "Center Partner",
};

export default function CompanySelect() {
  const { user, companies, switchCompany, logout } = useAuth();
  const nav = useNavigate();
  const [busyId, setBusyId] = useState(null);

  const pick = async (companyId) => {
    setBusyId(companyId);
    const res = await switchCompany(companyId);
    setBusyId(null);
    if (res.ok) {
      toast.success("Company selected");
      nav("/", { replace: true });
    } else {
      toast.error(res.error || "Could not switch company");
    }
  };

  const doLogout = async () => { await logout(); nav("/login", { replace: true }); };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #0b1f4d 0%, #123a86 55%, #1e50c9 100%)" }}
      data-testid="company-select-page"
    >
      <div className="w-full max-w-lg bg-white shadow-2xl border border-gray-100">
        <div className="p-7 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 flex items-center justify-center bg-[#0b1f4d] text-white font-heading font-black text-xl">
              M
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Mashara Skills</div>
              <h1 className="font-heading font-black text-2xl tracking-tight text-[#0b1f4d] leading-tight">
                Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
              </h1>
            </div>
          </div>
          <p className="text-sm text-[var(--muted)] mt-3">
            Select a company to continue. Your role &amp; access change per company.
          </p>
        </div>

        <div className="p-4 max-h-[55vh] overflow-y-auto" data-testid="company-select-list">
          {companies.length === 0 ? (
            <div className="text-center py-10 text-sm text-[var(--muted)]" data-testid="company-select-empty">
              You are not assigned to any company yet. Please contact your administrator.
            </div>
          ) : (
            <div className="space-y-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => pick(c.id)}
                  data-testid={`company-option-${c.id}`}
                  className="w-full flex items-center gap-3 p-4 border border-gray-200 hover:border-[var(--brand)] hover:bg-blue-50/40 transition-colors text-left disabled:opacity-60"
                >
                  <div className="h-10 w-10 flex items-center justify-center bg-blue-50 text-[var(--brand)] shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[#0b1f4d] truncate">{c.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono bg-gray-100 px-1.5 py-0.5 text-gray-600">{c.company_code}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--brand)]">
                        <ShieldCheck size={11} /> {ROLE_LABELS[c.role] || c.role}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-[var(--muted)] shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[11px] text-[var(--muted)]">{companies.length} compan{companies.length === 1 ? "y" : "ies"} available</span>
          <Button variant="outline" size="sm" className="rounded-none gap-2" onClick={doLogout} data-testid="company-select-logout">
            <LogOut size={14} /> Logout
          </Button>
        </div>
      </div>
    </div>
  );
}
