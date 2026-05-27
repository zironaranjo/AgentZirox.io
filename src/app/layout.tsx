import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ziro - Sistema Central",
  description: "Personal AI Agent — Terminal Neuronal Segura",
  icons: { icon: "/avatar.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${outfit.className} antialiased`}>
        {children}
      </body>
    </html>
  );
}
