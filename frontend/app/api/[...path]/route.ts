import { NextRequest, NextResponse } from "next/server";

// Proxy hacia el backend FastAPI. BACKEND_URL se lee en runtime (red interna de Docker),
// así el navegador nunca necesita conocer la URL del backend ni lidiar con CORS.
export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `${BACKEND_URL}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  try {
    const res = await fetch(target, { cache: "no-store" });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ detail: "Backend no disponible" }, { status: 502 });
  }
}
