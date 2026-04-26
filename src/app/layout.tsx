import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: "euler — a reader for math problems",
  description:
    "Upload a photograph of a math problem. euler extracts the statement, walks you through it, and answers your follow-ups.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-paper">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
