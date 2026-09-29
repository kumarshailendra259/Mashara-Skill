import React from "react";
import { useLang } from "@/context/LangContext";
import SettlementDashboard from "@/components/SettlementDashboard";
import FYSwitcher from "@/components/FYSwitcher";

export default function PartnerSettlement() {
  const { t } = useLang();
  return (
    <div className="space-y-6" data-testid="partner-settlement-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="overline">{t("grp_partnerships")}</div>
          <h1 className="font-heading font-black tracking-tight text-3xl mt-1">{t("partner_settlement")}</h1>
        </div>
        <FYSwitcher variant="inline" />
      </div>
      <SettlementDashboard />
    </div>
  );
}
