import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Factory — Control",
  description: "Control your Factory engine from anywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
