"use client";

import { useCallback, useEffect, useState } from "react";
import Planta, { type Animo } from "./Planta";
import styles from "./plantas.module.css";

type Device = {
  id: string;
  last_seen: string;
  last_temperature: number | null;
  last_humidity: number | null;
  last_soil_moisture: number | null;
  online: boolean;
};

// Umbrales del ánimo de la planta.
const TIERRA_SECA = 30; // % de humedad de tierra por debajo del cual tiene sed
const CALOR = 30; // °C a partir de los cuales tiene calor
const HUMEDAD_ALTA = 80; // % de humedad del aire a partir del cual se sofoca

const REFRESH_MS = 3000;

type Estado = {
  aireOk: boolean;
  tierraOk: boolean;
  presente: boolean;
  animo: Animo;
  activos: Animo[];
};

// El firmware envía temperatura 0 y humedad 0 cuando el DHT no responde.
function evaluar(d: Device): Estado {
  const aireOk =
    d.online && d.last_temperature != null && d.last_humidity != null &&
    !(d.last_temperature === 0 && d.last_humidity === 0);
  const tierraOk = d.online && d.last_soil_moisture != null;

  const activos: Animo[] = [];
  if (tierraOk && d.last_soil_moisture! < TIERRA_SECA) activos.push("sed");
  if (aireOk && d.last_temperature! >= CALOR) activos.push("calor");
  if (aireOk && d.last_humidity! >= HUMEDAD_ALTA) activos.push("sofocada");

  return { aireOk, tierraOk, presente: aireOk || tierraOk, animo: activos[0] ?? "feliz", activos };
}

const MENSAJES: Record<Animo, string> = {
  feliz: "¡Estoy feliz!",
  sed: "Tengo sed…",
  calor: "¡Qué calor!",
  sofocada: "Me sofoco…",
};

const ETIQUETAS: Record<Animo, string> = {
  feliz: "Feliz",
  sed: "Tierra seca",
  calor: "Calor",
  sofocada: "Humedad alta",
};

// Plantas de ejemplo para ver todas las animaciones sin sensores reales.
const ahora = new Date().toISOString();
const EJEMPLOS: Device[] = [
  { id: "ejemplo-feliz", last_seen: ahora, last_temperature: 24, last_humidity: 60, last_soil_moisture: 55, online: true },
  { id: "ejemplo-sed", last_seen: ahora, last_temperature: 23, last_humidity: 55, last_soil_moisture: 12, online: true },
  { id: "ejemplo-calor", last_seen: ahora, last_temperature: 34, last_humidity: 50, last_soil_moisture: 50, online: true },
  { id: "ejemplo-sofocada", last_seen: ahora, last_temperature: 26, last_humidity: 88, last_soil_moisture: 60, online: true },
  { id: "ejemplo-sin-tierra", last_seen: ahora, last_temperature: 22, last_humidity: 58, last_soil_moisture: null, online: true },
  { id: "ejemplo-vacia", last_seen: ahora, last_temperature: 0, last_humidity: 0, last_soil_moisture: null, online: true },
];

export default function Plantas() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const [ejemplos, setEjemplos] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} /api/devices`);
      setDevices(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargado(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const lista = ejemplos ? EJEMPLOS : devices;

  return (
    <main>
      <header>
        <h1>Plantas del invernadero</h1>
        <label className={`muted ${styles.toggle}`}>
          <input type="checkbox" checked={ejemplos} onChange={(e) => setEjemplos(e.target.checked)} />
          Ver ejemplos
        </label>
      </header>

      {error && !ejemplos && <p className="error">Error: {error}</p>}
      {cargado && lista.length === 0 && !error && <p className="muted">Aún no hay dispositivos registrados.</p>}

      <section className={styles.grid}>
        {lista.map((d) => (
          <TarjetaPlanta key={d.id} device={d} />
        ))}
      </section>

      <section className={`card ${styles.leyenda}`}>
        <h2>Cómo se siente cada planta</h2>
        <span className="muted">Cada tarjeta es un dispositivo con su sensor de aire (temperatura y humedad) y su sensor de humedad de tierra.</span>
        <span className="muted">Tengo sed: tierra por debajo del {TIERRA_SECA} %. ¡Qué calor!: {CALOR} °C o más. Me sofoco: humedad del aire del {HUMEDAD_ALTA} % o más.</span>
        <span className="muted">Si ningún sensor responde, o el dispositivo lleva más de 30 s sin reportar, la maceta aparece vacía.</span>
      </section>
    </main>
  );
}

function TarjetaPlanta({ device: d }: { device: Device }) {
  const e = evaluar(d);
  const fallas = [!e.aireOk && "Sensor de aire sin datos", !e.tierraOk && "Sensor de tierra sin datos"].filter(Boolean) as string[];

  return (
    <article className={`card ${styles.tarjeta} ${e.presente ? "" : styles.vacia}`}>
      <h2>{d.id}</h2>
      <Planta presente={e.presente} animo={e.animo} tierra={e.tierraOk ? d.last_soil_moisture : null} />
      <p className={styles.mensaje}>
        {!d.online ? "Sin conexión: maceta vacía" : e.presente ? MENSAJES[e.animo] : "Maceta vacía: ningún sensor responde"}
      </p>

      <div className={styles.chips}>
        {e.presente && e.activos.map((a) => <span key={a} className={styles.chip}>{ETIQUETAS[a]}</span>)}
        {e.presente && d.online && fallas.map((f) => <span key={f} className={`${styles.chip} ${styles.aviso}`}>{f}</span>)}
      </div>

      <div className={styles.sensores}>
        <Sensor nombre="Temperatura" ok={e.aireOk} valor={`${d.last_temperature?.toFixed(1)} °C`} />
        <Sensor nombre="Humedad del aire" ok={e.aireOk} valor={`${d.last_humidity?.toFixed(0)} %`} />
        <Sensor nombre="Humedad de tierra" ok={e.tierraOk} valor={`${d.last_soil_moisture?.toFixed(0)} %`} />
      </div>
    </article>
  );
}

function Sensor({ nombre, ok, valor }: { nombre: string; ok: boolean; valor: string }) {
  return (
    <div className={styles.sensor}>
      <span className={styles.nombre}>
        <span className={`dot ${ok ? "on" : "off"}`} />
        {nombre}
      </span>
      <span className={ok ? "" : styles.falla}>{ok ? valor : "sin lectura"}</span>
    </div>
  );
}
