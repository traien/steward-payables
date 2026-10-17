import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Steward — Pay with proof.",
  description:
    "An accountable invoice payments agent. Verify obligations, protect your cash reserve, and record the reason for every payment. Explore the sample business or run a private Arc sandbox pilot.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
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
