import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invernadero IoT",
  description: "Lecturas de temperatura y humedad de los dispositivos del invernadero",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
