import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: process.env.EVENT_NAME ? `Påmelding – ${process.env.EVENT_NAME}` : "Påmelding",
  description: "Påmelding og billetter",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
