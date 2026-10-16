import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Building2, Check, ChevronDown } from "lucide-react";

/**
 * Company Switcher — shown in the top header for users associated with more
 * than one company. Switching recalculates the active company, role and
 * center scope (backend-enforced) then reloads the app data.
 */
export default function CompanySwitcher() {
  const { scope, companies, switchCompany, isSuperCompanies } = useAuth();
  const [busy, setBusy] = useState(false);

  // Super Admin is global — no per-company switch here. Only multi-company
  // (2+) tenant users get the switcher.
  if (isSuperCompanies) return null;
  if (!companies || companies.length < 2) return null;

  const activeId = scope?.active_company_id;
  const active = companies.find((c) => c.id === activeId);

  const onPick = async (companyId) => {
    if (companyId === activeId) return;
    setBusy(true);
    const res = await switchCompany(companyId);
    setBusy(false);
    if (res.ok) {
      const c = companies.find((x) => x.id === companyId);
      toast.success(`Switched to ${c?.name || "company"}`);
      // Hard refresh so every page/module reloads with the new company's data
      // and scope (per user preference: Company switch = full refresh).
      window.location.assign("/");
    } else {
      toast.error(res.error || "Could not switch company");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          className="rounded-none gap-1.5 h-9 max-w-[180px] border-[var(--brand)]/40"
          data-testid="company-switcher"
        >
          <Building2 size={14} className="text-[var(--brand)] shrink-0" />
          <span className="truncate font-semibold">{active?.name || "Select Company"}</span>
          <ChevronDown size={13} className="shrink-0 text-[var(--muted)]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-none w-64 max-h-96 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Switch Company</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => onPick(c.id)}
            data-testid={`company-switch-${c.id}`}
            className="gap-2 cursor-pointer"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{c.name}</div>
              <div className="text-[10px] font-mono text-[var(--muted)]">{c.company_code} · {c.role}</div>
            </div>
            {c.id === activeId && <Check size={14} className="text-[var(--brand)] shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
