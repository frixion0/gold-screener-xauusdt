import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gold Screener - Real-Time XAU/USDT 3Min Chart",
  description: "Real-time XAU/USDT crypto screener with live 3-minute candlestick chart. Track gold price movements with live Binance WebSocket data.",
  keywords: ["Gold", "XAUUSDT", "crypto screener", "real-time chart", "trading", "3-minute candles"],
  authors: [{ name: "Gold Screener" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Gold Screener - Real-Time XAU/USDT",
    description: "Real-time XAU/USDT crypto screener with live 3-minute candlestick chart",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
