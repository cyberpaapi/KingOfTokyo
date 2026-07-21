import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "Kaiju Clash — Neon Monster Dice",
    description: "A complete original digital monster-dice tabletop showdown. Roll, battle, buy powers, and rule Neon City.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Kaiju Clash",
      description: "Roll. Wreck. Rule the city.",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Kaiju Clash monster-dice showdown" }],
    },
    twitter: { card: "summary_large_image", title: "Kaiju Clash", description: "Roll. Wreck. Rule the city.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
