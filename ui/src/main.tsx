import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { FactoryProvider } from "@/lib/data";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FactoryProvider>
      <App />
      <Toaster position="bottom-right" />
    </FactoryProvider>
  </React.StrictMode>,
);
