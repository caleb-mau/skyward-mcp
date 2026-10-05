import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skyward MCP",
  description: "Unofficial self hosted MCP server for Skyward",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
