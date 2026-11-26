import type { Metadata } from "next";
import "./globals.css";
import Nav from "./Nav";
import JardinFondo from "./JardinFondo";

export const metadata: Metadata = {
  title: "Invernadero IoT",
  description: "Lecturas de temperatura, humedad y humedad de tierra de las plantas del invernadero",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <JardinFondo />
        <Nav />
        {children}
      </body>
    </html>
  );
}
