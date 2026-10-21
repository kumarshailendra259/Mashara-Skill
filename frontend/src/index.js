import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

// Silence benign "ResizeObserver loop" warnings (fired by shadcn Popover/Command
// resizing inside dialogs) so CRA's dev error overlay doesn't show a noisy red screen.
const _roLoopRe = /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/;
window.addEventListener("error", (e) => {
  if (e.message && _roLoopRe.test(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
