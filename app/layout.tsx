import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SnowLens — データをすぐ、深く。",
  description: "Snowflakeのデータを、SQLなしで探索",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
