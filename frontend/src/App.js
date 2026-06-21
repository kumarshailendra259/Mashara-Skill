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
            <Route path="/" element={<ProtectedRoute><Shell><Dashboard /></Shell></ProtectedRoute>} />
            <Route path="/companies" element={<ProtectedRoute><Shell><Entities etype="company" /></Shell></ProtectedRoute>} />
            <Route path="/partners" element={<ProtectedRoute><Shell><Entities etype="partner" /></Shell></ProtectedRoute>} />
            <Route path="/centers" element={<ProtectedRoute><Shell><Entities etype="center" /></Shell></ProtectedRoute>} />
            <Route path="/projects" element={<ProtectedRoute><Shell><Entities etype="project" /></Shell></ProtectedRoute>} />
            <Route path="/transactions" element={<ProtectedRoute><Shell><Transactions /></Shell></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Shell><Reports /></Shell></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </LangProvider>
  );
}

export default App;
