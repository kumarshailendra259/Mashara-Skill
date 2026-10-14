import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LangProvider } from "@/context/LangContext";
import { AuthProvider } from "@/context/AuthContext";
import { PermissionProvider } from "@/context/PermissionContext";
import { FYProvider } from "@/context/FYContext";
import MenuAccessControl from "@/pages/MenuAccessControl";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Entities from "@/pages/Entities";
import Transactions from "@/pages/Transactions";
import Reports from "@/pages/Reports";
import Users from "@/pages/Users";
import HRMS from "@/pages/HRMS";
import MyProfile from "@/pages/MyProfile";
import StaffSalaryDetail from "@/pages/StaffSalaryDetail";
import StaffProfile from "@/pages/StaffProfile";
import Advances from "@/pages/Advances";
import Stock from "@/pages/Stock";
import ApprovalLog from "@/pages/ApprovalLog";
import ApprovalWorkflows from "@/pages/ApprovalWorkflows";
import HrSettings from "@/pages/HrSettings";
import Programs from "@/pages/Programs";
import BatchManagement from "@/pages/BatchManagement";
import CheckIn from "@/pages/CheckIn";
import ForgotPassword from "@/pages/ForgotPassword";
import PartnerAssociations from "@/pages/PartnerAssociations";
import TdsRegister from "@/pages/TdsRegister";
import PendingApprovals from "@/pages/PendingApprovals";
import MessManagement from "@/pages/MessManagement";
import LoginHistory from "@/pages/LoginHistory";
import AssetManagement from "@/pages/AssetManagement";
import EmployeeTransfers from "@/pages/EmployeeTransfers";
import CenterManagerDashboard from "@/pages/CenterManagerDashboard";
import Quotations from "@/pages/Quotations";
import Vendors from "@/pages/Vendors";
import Candidates from "@/pages/Candidates";
import BankGuarantees from "@/pages/BankGuarantees";
import MISDashboard from "@/pages/mis/MISDashboard";
import PaymentDashboard from "@/pages/PaymentDashboard";
import BankReconciliation from "@/pages/BankReconciliation";
import Invoices from "@/pages/Invoices";
import InvoiceDetail from "@/pages/InvoiceDetail";
import StaffFinancialHistory from "@/pages/StaffFinancialHistory";
import Notifications from "@/pages/Notifications";
import SubscriptionBilling from "@/pages/SubscriptionBilling";
import CompaniesAdmin from "@/pages/CompaniesAdmin";
import CenterManagement from "@/pages/CenterManagement";
import CompanySelect from "@/pages/CompanySelect";
import PartnerSettlement from "@/pages/PartnerSettlement";
import CourseMaster from "@/pages/CourseMaster";
import RateConfig from "@/pages/RateConfig";
import EntityMappings from "@/pages/EntityMappings";
import { useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import "@/App.css";

function Shell({ children }) {
  return <Layout>{children}</Layout>;
}

// Auth-only wrapper WITHOUT the company-select gate (used by /select-company).
function AuthedOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-sm overline">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Renders the appropriate "/" landing page based on user role.
// Finance roles → financial Dashboard. center_manager → operational CenterManagerDashboard.
function RoleHome() {
  const { user } = useAuth();
  if (user?.role === "center_manager") return <CenterManagerDashboard />;
  return <Dashboard />;
}

function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <PermissionProvider>
        <FYProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/select-company" element={<AuthedOnly><CompanySelect /></AuthedOnly>} />
            <Route path="/" element={<ProtectedRoute requireFinance><Shell><RoleHome /></Shell></ProtectedRoute>} />
            <Route path="/companies" element={<ProtectedRoute><Shell><Entities etype="company" /></Shell></ProtectedRoute>} />
            <Route path="/partners" element={<ProtectedRoute><Shell><Entities etype="partner" /></Shell></ProtectedRoute>} />
            <Route path="/centers" element={<ProtectedRoute><Shell><Entities etype="center" /></Shell></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Shell><Entities etype="project" /></Shell></ProtectedRoute>} />
            <Route path="/transactions" element={<ProtectedRoute requireFinance><Shell><Transactions /></Shell></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute requireFinance><Shell><Reports /></Shell></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><Shell><Users /></Shell></ProtectedRoute>} />
            <Route path="/hrms" element={<ProtectedRoute><Shell><HRMS /></Shell></ProtectedRoute>} />
            <Route path="/me/profile" element={<ProtectedRoute><Shell><MyProfile /></Shell></ProtectedRoute>} />
            <Route path="/hrms/staff/:sid/salary" element={<ProtectedRoute><Shell><StaffSalaryDetail /></Shell></ProtectedRoute>} />
            <Route path="/hrms/staff/:sid/profile" element={<ProtectedRoute><Shell><StaffProfile /></Shell></ProtectedRoute>} />
            <Route path="/advances" element={<ProtectedRoute><Shell><Advances /></Shell></ProtectedRoute>} />
            <Route path="/stock" element={<ProtectedRoute><Shell><Stock /></Shell></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><Shell><ApprovalLog /></Shell></ProtectedRoute>} />
            <Route path="/approval-workflows" element={<ProtectedRoute><Shell><ApprovalWorkflows /></Shell></ProtectedRoute>} />
            <Route path="/hr-settings" element={<ProtectedRoute><Shell><HrSettings /></Shell></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Shell><Notifications /></Shell></ProtectedRoute>} />
            <Route path="/subscription" element={<ProtectedRoute><Shell><SubscriptionBilling /></Shell></ProtectedRoute>} />
            <Route path="/companies-admin" element={<ProtectedRoute><Shell><CompaniesAdmin /></Shell></ProtectedRoute>} />
            <Route path="/center-management" element={<ProtectedRoute><Shell><CenterManagement /></Shell></ProtectedRoute>} />
            <Route path="/course-master" element={<ProtectedRoute><Shell><CourseMaster /></Shell></ProtectedRoute>} />
            <Route path="/rate-config" element={<ProtectedRoute requireAdmin><Shell><RateConfig /></Shell></ProtectedRoute>} />
            <Route path="/entity-mappings" element={<ProtectedRoute><Shell><EntityMappings /></Shell></ProtectedRoute>} />
            <Route path="/programs" element={<ProtectedRoute><Shell><Programs /></Shell></ProtectedRoute>} />
            <Route path="/batch-management" element={<ProtectedRoute><Shell><BatchManagement /></Shell></ProtectedRoute>} />
            <Route path="/partner-associations" element={<ProtectedRoute><Shell><PartnerAssociations /></Shell></ProtectedRoute>} />
            <Route path="/partner-settlement" element={<ProtectedRoute requireFinance><Shell><PartnerSettlement /></Shell></ProtectedRoute>} />
            <Route path="/tds-register" element={<ProtectedRoute requireFinance><Shell><TdsRegister /></Shell></ProtectedRoute>} />
            <Route path="/pending-approvals" element={<ProtectedRoute><Shell><PendingApprovals /></Shell></ProtectedRoute>} />
            <Route path="/mess" element={<ProtectedRoute><Shell><MessManagement /></Shell></ProtectedRoute>} />
            <Route path="/login-history" element={<ProtectedRoute><Shell><LoginHistory /></Shell></ProtectedRoute>} />
            <Route path="/assets" element={<ProtectedRoute><Shell><AssetManagement /></Shell></ProtectedRoute>} />
            <Route path="/employee-transfers" element={<ProtectedRoute><Shell><EmployeeTransfers /></Shell></ProtectedRoute>} />
            <Route path="/quotations" element={<ProtectedRoute><Shell><Quotations /></Shell></ProtectedRoute>} />
            <Route path="/payment-dashboard" element={<ProtectedRoute requireFinance><Shell><PaymentDashboard /></Shell></ProtectedRoute>} />
            <Route path="/bank-reconciliation" element={<ProtectedRoute><Shell><BankReconciliation /></Shell></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><Shell><Invoices /></Shell></ProtectedRoute>} />
            <Route path="/invoices/:id" element={<ProtectedRoute><Shell><InvoiceDetail /></Shell></ProtectedRoute>} />
            <Route path="/hrms/financial-history" element={<ProtectedRoute><Shell><StaffFinancialHistory /></Shell></ProtectedRoute>} />
            <Route path="/vendors" element={<ProtectedRoute><Shell><Vendors /></Shell></ProtectedRoute>} />
            <Route path="/candidates" element={<ProtectedRoute><Shell><Candidates /></Shell></ProtectedRoute>} />
            <Route path="/bank-guarantees" element={<ProtectedRoute><Shell><BankGuarantees /></Shell></ProtectedRoute>} />
            <Route path="/mis" element={<ProtectedRoute><Shell><MISDashboard /></Shell></ProtectedRoute>} />
            <Route path="/menu-access-control" element={<ProtectedRoute requireAdmin><Shell><MenuAccessControl /></Shell></ProtectedRoute>} />
            <Route path="/check-in" element={<CheckIn />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
        </FYProvider>
        </PermissionProvider>
      </AuthProvider>
    </LangProvider>
  );
}

export default App;
