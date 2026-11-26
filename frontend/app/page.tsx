"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Stats = {
  devices: number;
  devices_online: number;
  total_readings: number;
  readings_last_minute: number;
  avg_temperature_1h: number | null;
  avg_humidity_1h: number | null;
};

type Device = {
  id: string;
  first_seen: string;
  last_seen: string;
  last_temperature: number | null;
  last_humidity: number | null;
  last_soil_moisture: number | null;
  readings_count: number;
  online: boolean;
};

type Reading = {
  id: number;
  device_id: string;
  temperature: number;
  humidity: number;
  soil_moisture: number | null;
  measured_at: string;
  stored_at: string;
};

const REFRESH_MS = 3000;
const fmt = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
const time = (iso: string) => new Date(iso).toLocaleTimeString("es", { hour12: false });

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [minutes, setMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ minutes: String(minutes), limit: "2000" });
      if (selected) qs.set("device_id", selected);
      const [s, d, r] = await Promise.all([
        getJSON<Stats>("/api/stats"),
        getJSON<Device[]>("/api/devices"),
        getJSON<Reading[]>(`/api/readings?${qs}`),
      ]);
      setStats(s);
      setDevices(d);
      setReadings(r);
      setError(null);
      setUpdatedAt(new Date());
      if (!selected && d.length > 0) setSelected(d[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selected, minutes]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // La API devuelve DESC; las gráficas necesitan orden cronológico.
  const series = useMemo(
    () =>
      readings
        .filter((r) => !selected || r.device_id === selected)
        .slice()
        .reverse()
        .map((r) => ({
          t: new Date(r.measured_at).getTime(),
          temperature: r.temperature,
          humidity: r.humidity,
          soil_moisture: r.soil_moisture,
        })),
    [readings, selected],
  );

  return (
    <main>
      <header>
        <h1>Invernadero · Monitoreo IoT</h1>
        <span className="muted">
          {error ? <span className="error">Error: {error}</span> : updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString("es", { hour12: false })} · cada ${REFRESH_MS / 1000}s` : "Cargando…"}
        </span>
      </header>

      <section className="kpis">
        <Kpi label="Dispositivos en línea" value={stats ? `${stats.devices_online} / ${stats.devices}` : "—"} sub="reportaron en los últimos 30 s" />
        <Kpi label="Lecturas totales" value={stats ? stats.total_readings.toLocaleString("es") : "—"} sub={stats ? `${stats.readings_last_minute} en el último minuto` : ""} />
        <Kpi label="Temperatura promedio" value={stats ? `${fmt(stats.avg_temperature_1h)} °C` : "—"} sub="última hora, todos los dispositivos" />
        <Kpi label="Humedad promedio" value={stats ? `${fmt(stats.avg_humidity_1h)} %` : "—"} sub="última hora, todos los dispositivos" />
      </section>

      <div className="toolbar">
        <label className="muted" htmlFor="dev">Dispositivo</label>
        <select id="dev" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.id}</option>
          ))}
        </select>
        <label className="muted" htmlFor="win">Ventana</label>
        <select id="win" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          <option value={5}>5 min</option>
          <option value={15}>15 min</option>
          <option value={60}>1 hora</option>
          <option value={360}>6 horas</option>
          <option value={1440}>24 horas</option>
        </select>
      </div>

      <section className="grid-2">
        <ChartCard title="Temperatura" unit="°C" dataKey="temperature" color="var(--series-temp)" data={series} />
        <ChartCard title="Humedad relativa" unit="%" dataKey="humidity" color="var(--series-hum)" data={series} />
        <ChartCard title="Humedad de tierra" unit="%" dataKey="soil_moisture" color="var(--series-soil)" data={series} domain={[0, 100]} />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Dispositivos</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Estado</th>
                <th className="num">Temp. (°C)</th>
                <th className="num">Humedad aire (%)</th>
                <th className="num">Humedad tierra (%)</th>
                <th className="num">Lecturas</th>
                <th>Última lectura</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 && (
                <tr><td colSpan={7} className="muted">Sin dispositivos todavía. Envía datos con test-comunication.py o desde un dispositivo.</td></tr>
              )}
              {devices.map((d) => (
                <tr key={d.id} className={`clickable ${d.id === selected ? "selected" : ""}`} onClick={() => setSelected(d.id)}>
                  <td>{d.id}</td>
                  <td>
                    <span className="status">
                      <span className={`dot ${d.online ? "on" : "off"}`} aria-hidden />
                      {d.online ? "En línea" : "Sin señal"}
                    </span>
                  </td>
                  <td className="num">{fmt(d.last_temperature, 2)}</td>
                  <td className="num">{fmt(d.last_humidity, 2)}</td>
                  <td className="num">{fmt(d.last_soil_moisture, 1)}</td>
                  <td className="num">{d.readings_count.toLocaleString("es")}</td>
                  <td>{time(d.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Últimas lecturas {selected && <span className="muted">· {selected}</span>}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Dispositivo</th>
                <th className="num">Temp. (°C)</th>
                <th className="num">Humedad aire (%)</th>
                <th className="num">Humedad tierra (%)</th>
                <th>Medido</th>
                <th>Guardado</th>
              </tr>
            </thead>
            <tbody>
              {readings.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className="muted">{r.id}</td>
                  <td>{r.device_id}</td>
                  <td className="num">{fmt(r.temperature, 2)}</td>
                  <td className="num">{fmt(r.humidity, 2)}</td>
                  <td className="num">{fmt(r.soil_moisture, 1)}</td>
                  <td>{time(r.measured_at)}</td>
                  <td>{time(r.stored_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function ChartCard({
  title,
  unit,
  dataKey,
  color,
  data,
  domain = ["auto", "auto"],
}: {
  title: string;
  unit: string;
  dataKey: "temperature" | "humidity" | "soil_moisture";
  color: string;
  data: { t: number; temperature: number; humidity: number; soil_moisture: number | null }[];
  domain?: [number | "auto", number | "auto"];
}) {
  const last = data.at(-1)?.[dataKey];
  const sinDatos = data.every((p) => p[dataKey] == null);
  return (
    <div className="card">
      <h2>
        <span className="swatch" style={{ background: color }} />
        {title} <span className="muted">· actual {fmt(last, 2)} {unit}</span>
      </h2>
      <div style={{ width: "100%", height: 240 }}>
        {sinDatos ? (
          <p className="muted">Sin datos en la ventana seleccionada.</p>
        ) : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => new Date(v).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", hour12: false })}
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={40}
              />
              <YAxis
                domain={domain}
                stroke="var(--text-muted)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                unit={unit === "%" ? "%" : "°"}
                width={52}
              />
              <Tooltip
                cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="tooltip">
                      <div className="muted">{time(new Date(Number(label)).toISOString())}</div>
                      <div>
                        {title}: <strong>{fmt(Number(payload[0].value), 2)} {unit}</strong>
                      </div>
                    </div>
                  ) : null
                }
              />
              <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
