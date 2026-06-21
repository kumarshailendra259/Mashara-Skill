import React from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

/**
 * PrintButton — opens browser print preview for the current page.
 * Hidden in print output via the `no-print` class.
 */
export default function PrintButton({ label = "Print", size = "sm", className = "" }) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={() => window.print()}
      className={`rounded-none gap-2 no-print ${className}`}
      data-testid="btn-print"
    >
      <Printer size={14} /> {label}
    </Button>
  );
}
