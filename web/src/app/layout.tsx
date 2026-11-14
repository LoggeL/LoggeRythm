import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import AppShell from "@/components/shell/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const displayFace = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LoggeRythm",
  description: "LoggeRythm – dein privater Musikstream.",
  appleWebApp: {
    capable: true,
    title: "LoggeRythm",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  // Matches --backdrop from globals.css.
  themeColor: "#050608",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} ${displayFace.variable} h-full antialiased`}
    >
      <body className="h-full">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
