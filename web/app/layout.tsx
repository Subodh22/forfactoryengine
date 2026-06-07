import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Black, Space_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { FactoryProvider } from "@/lib/data";
import { Toaster } from "@/components/ui/sonner";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], display: "swap" });
const archivoBlack = Archivo_Black({ variable: "--font-archivo-black", weight: "400", subsets: ["latin"], display: "swap" });
const spaceMono = Space_Mono({ variable: "--font-space-mono", weight: ["400", "700"], subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Factory — AI Software Factory",
  description: "Multi-repo AI coding agent orchestrator",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${archivoBlack.variable} ${spaceMono.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        <FactoryProvider>
          {children}
          <Toaster position="bottom-right" />
        </FactoryProvider>
      </body>
    </html>
  );
}
