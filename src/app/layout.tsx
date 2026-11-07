import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import AuthHeader from "@/components/AuthHeader";
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
  title: "TM7 — งานวันนี้ (toyka)",
  description: "Fill in your details and instantly generate a printable TM.7 visa extension form (with STM.2, STM.9, and STM.11).",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the session on the server so the client SessionProvider hydrates
  // without an extra round-trip / auth flash.
  const session = await auth();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <SessionProvider session={session}>
          <AuthHeader />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
