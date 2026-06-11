"use client";
import type { ReactNode } from "react";
import { FactoryProvider } from "@/lib/data";
import { Toaster } from "@/components/ui/sonner";
import { configureEngine } from "@/lib/api";

// The web app is a remote client, so it always targets the engine over the
// network. NEXT_PUBLIC_ENGINE_URL is inlined at build time.
configureEngine(process.env.NEXT_PUBLIC_ENGINE_URL || "http://localhost:8787");

export function Providers({ children }: { children: ReactNode }) {
  return (
    <FactoryProvider>
      {children}
      <Toaster position="bottom-right" />
    </FactoryProvider>
  );
}
