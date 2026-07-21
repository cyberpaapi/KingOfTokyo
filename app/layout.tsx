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
    title: "Kaiju Clash — Monster Dice Mayhem",
    description: "A vibrant digital monster-dice board game with 66 power cards, solo play, and live room-code multiplayer.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Kaiju Clash", description: "Roll. Wreck. Rule Tokyo.", images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Kaiju Clash monster-dice showdown" }] },
    twitter: { card: "summary_large_image", title: "Kaiju Clash", description: "Roll. Wreck. Rule Tokyo.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
