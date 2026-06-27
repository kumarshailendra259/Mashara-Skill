import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

// Roles that may see investments / income / expense / profit-loss / milestones / TDS.
// Must mirror FINANCE_VISIBLE_ROLES in backend/server.py.
const FINANCE_VISIBLE_ROLES = ["admin", "partner", "senior_manager", "hr", "accountant"];

// Where to send a non-finance user instead of the financial dashboard.
const LANDING_FOR_ROLE = {
  center_manager:      "/hrms",
  manager:             "/hrms",
  center_staff:        "/check-in",
  viewer:              "/pending-approvals",
  reporting_authority: "/pending-approvals",
  center_partner:      "/pending-approvals",
};

export default function ProtectedRoute({ children, requireFinance = false }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-sm overline" data-testid="loading-screen">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (requireFinance && !FINANCE_VISIBLE_ROLES.includes(user.role)) {
    return <Navigate to={LANDING_FOR_ROLE[user.role] || "/hrms"} replace />;
  }
  return children;
}
