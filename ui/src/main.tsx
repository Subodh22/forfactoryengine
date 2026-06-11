import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/components/AppShell";
import { FactoryProvider } from "@/lib/data";
import { Toaster } from "@/components/ui/sonner";
import { configureEngine } from "@/lib/api";
import "./index.css";

// Same-origin by default: Vite proxies /api + /ws to the engine in dev, and the
// engine serves the built UI in prod. VITE_ENGINE_URL points a hosted build
// elsewhere.
configureEngine((import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FactoryProvider>
      <App />
      <Toaster position="bottom-right" />
    </FactoryProvider>
  </React.StrictMode>,
);
