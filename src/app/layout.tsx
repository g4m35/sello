import type { Metadata } from "next";
import { Manrope, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sello.wtf"),
  title: "Sello — Resale crosslisting",
  description: "AI-assisted resale cross-listing for streetwear, sneakers, and hype-fashion sellers.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/sello-mark.svg",
  },
  openGraph: {
    images: ["/sello-mark.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-density="regular"
      suppressHydrationWarning
      className={`${manrope.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Apply the color theme before paint to avoid a flash. Mirrors
            resolveInitialTheme in src/lib/theme.ts (keep the storage key in sync). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var k="counter-theme";var s=localStorage.getItem(k);var d=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=(s==="light"||s==="dark")?s:(d?"dark":"light");}catch(e){}})();',
          }}
        />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
