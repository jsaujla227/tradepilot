import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DisclaimerFooter } from "@/components/disclaimer-footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TradePilot",
  description: "Private trading cockpit — paper trading, risk discipline, AI helper.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased min-h-screen flex flex-col`}
      >
        <main className="flex-1 flex flex-col">{children}</main>
        <DisclaimerFooter />
      </body>
    </html>
  );
}
