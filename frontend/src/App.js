import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LangProvider } from "@/context/LangContext";
import { AuthProvider } from "@/context/AuthContext";
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
import Stock from "@/pages/Stock";
import ApprovalLog from "@/pages/ApprovalLog";
import ApprovalWorkflows from "@/pages/ApprovalWorkflows";
import HrSettings from "@/pages/HrSettings";
import Programs from "@/pages/Programs";
import CheckIn from "@/pages/CheckIn";
import ForgotPassword from "@/pages/ForgotPassword";
import PartnerAssociations from "@/pages/PartnerAssociations";
import TdsRegister from "@/pages/TdsRegister";
import PendingApprovals from "@/pages/PendingApprovals";
import { Toaster } from "@/components/ui/sonner";
import "@/App.css";

function Shell({ children }) {
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/" element={<ProtectedRoute><Shell><Dashboard /></Shell></ProtectedRoute>} />
            <Route path="/companies" element={<ProtectedRoute><Shell><Entities etype="company" /></Shell></ProtectedRoute>} />
            <Route path="/partners" element={<ProtectedRoute><Shell><Entities etype="partner" /></Shell></ProtectedRoute>} />
            <Route path="/centers" element={<ProtectedRoute><Shell><Entities etype="center" /></Shell></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Shell><Entities etype="project" /></Shell></ProtectedRoute>} />
            <Route path="/transactions" element={<ProtectedRoute><Shell><Transactions /></Shell></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Shell><Reports /></Shell></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><Shell><Users /></Shell></ProtectedRoute>} />
            <Route path="/hrms" element={<ProtectedRoute><Shell><HRMS /></Shell></ProtectedRoute>} />
            <Route path="/stock" element={<ProtectedRoute><Shell><Stock /></Shell></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute><Shell><ApprovalLog /></Shell></ProtectedRoute>} />
            <Route path="/approval-workflows" element={<ProtectedRoute><Shell><ApprovalWorkflows /></Shell></ProtectedRoute>} />
            <Route path="/hr-settings" element={<ProtectedRoute><Shell><HrSettings /></Shell></ProtectedRoute>} />
            <Route path="/programs" element={<ProtectedRoute><Shell><Programs /></Shell></ProtectedRoute>} />
            <Route path="/partner-associations" element={<ProtectedRoute><Shell><PartnerAssociations /></Shell></ProtectedRoute>} />
            <Route path="/tds-register" element={<ProtectedRoute><Shell><TdsRegister /></Shell></ProtectedRoute>} />
            <Route path="/pending-approvals" element={<ProtectedRoute><Shell><PendingApprovals /></Shell></ProtectedRoute>} />
            <Route path="/check-in" element={<CheckIn />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </LangProvider>
  );
}

export default App;
