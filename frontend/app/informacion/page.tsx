"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import styles from "./informacion.module.css";

type ConfigDispositivo = {
  mqtt_host: string;
  mqtt_port: number;
  portal_ap_name: string;
  portal_ap_password: string;
  portal_ip: string;
  default_device_prefix: string;
};

type Device = { id: string };

// El device_id va en el tópico MQTT: solo letras, números, '-' y '_' (igual que el firmware).
const limpiarId = (id: string) => id.trim().replace(/[^A-Za-z0-9_-]/g, "");

// Formato estándar de QR para unirse a una red WiFi; estos caracteres van escapados.
const escaparWifi = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

function useQR(texto: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!texto) {
      setSrc(null);
      return;
    }
    let vigente = true;
    QRCode.toDataURL(texto, { margin: 2, width: 240, errorCorrectionLevel: "M", color: { dark: "#2b1d12", light: "#ffffff" } })
      .then((url) => vigente && setSrc(url))
      .catch(() => vigente && setSrc(null));
    return () => {
      vigente = false;
    };
  }, [texto]);
  return src;
}

export default function Informacion() {
  const [config, setConfig] = useState<ConfigDispositivo | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [nuevoNombre, setNuevoNombre] = useState("");
  const [ssid, setSsid] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [host, setHost] = useState("");
  const [puerto, setPuerto] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/config/dispositivo", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`${r.status} /api/config/dispositivo`);
        return r.json() as Promise<ConfigDispositivo>;
      }),
      fetch("/api/devices", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Device[]>) : [])),
    ])
      .then(([c, d]) => {
        setConfig(c);
        setDevices(d);
        setHost(c.mqtt_host);
        setPuerto(String(c.mqtt_port));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const red = config?.portal_ap_name ?? "";
  const qrRedTexto = config ? `WIFI:T:WPA;S:${escaparWifi(red)};P:${escaparWifi(config.portal_ap_password)};;` : null;

  const idFinal = limpiarId(nuevoNombre);
  const puertoNum = Number(puerto);
  const faltan = [
    !ssid.trim() && "el nombre de tu WiFi",
    !host.trim() && "el servidor MQTT",
    !(puertoNum > 0 && puertoNum <= 65535) && "un puerto válido",
  ].filter(Boolean) as string[];

  const enlaceConfig = useMemo(() => {
    if (!config || faltan.length) return null;
    const qs = new URLSearchParams({ s: ssid, p: clave, mqtt_host: host.trim(), mqtt_port: String(puertoNum) });
    if (idFinal) qs.set("device_id", idFinal); // vacío = la placa conserva su nombre
    return `http://${config.portal_ip}/wifisave?${qs}`;
  }, [config, faltan.length, ssid, clave, host, puertoNum, idFinal]);

  const qrRed = useQR(qrRedTexto);
  const qrConfig = useQR(enlaceConfig);

  return (
    <main>
      <header>
        <h1>Información</h1>
        <span className="muted">Datos para configurar los ESP32 desde su portal WiFi</span>
      </header>

      {error && <p className="error">Error: {error}</p>}

      <section className={`card ${styles.seccion}`}>
        <h2>Datos del servidor y del portal</h2>
        <dl className={styles.datos}>
          <dt>Servidor MQTT</dt>
          <dd><code>{config ? config.mqtt_host || "sin definir (MQTT_PUBLIC_HOST en .env)" : "—"}</code></dd>
          <dt>Puerto MQTT</dt>
          <dd><code>{config?.mqtt_port ?? "—"}</code></dd>
          <dt>Red WiFi del portal</dt>
          <dd><code>{config?.portal_ap_name ?? "—"}</code> <span className="muted">(la misma en todas las placas)</span></dd>
          <dt>Contraseña del portal</dt>
          <dd><code>{config?.portal_ap_password ?? "—"}</code></dd>
          <dt>Página del portal</dt>
          <dd><code>{config ? `http://${config.portal_ip}` : "—"}</code></dd>
          <dt>Plantas registradas</dt>
          <dd>{devices.length ? devices.map((d) => <code key={d.id} className={styles.tag}>{d.id}</code>) : "—"}</dd>
        </dl>
        <p className="muted">
          La placa abre el portal cuando no tiene WiFi guardado o no logra conectarse al arrancar. Para forzarlo, mantén
          pulsado BOOT 3 segundos con la placa encendida. Todas las placas usan la misma red de configuración: configúralas
          de una en una. Una placa nueva aparece como{" "}
          <code>{config?.default_device_prefix ?? "planta-"}&lt;id&gt;</code> (el id único se ve en la página del portal)
          hasta que le pongas un nombre.
        </p>
      </section>

      <section className={`card ${styles.seccion}`}>
        <h2>Configurar un ESP32 con códigos QR</h2>
        <p className="muted">
          Rellena los datos y escanea los dos códigos con la cámara del móvil, en orden. Tu contraseña del WiFi solo se usa
          en este navegador para crear el código: no se envía al servidor ni se guarda.
        </p>

        <div className={styles.formulario}>
          <label>
            <span>Nombre de la planta (opcional)</span>
            <input list="placas" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="tomate-1" />
            <small className="muted">
              {nuevoNombre && idFinal !== nuevoNombre.trim() ? `Se usará: ${idFinal || "—"}` : "Vacío = la placa conserva su nombre actual"}
            </small>
          </label>
          <label>
            <span>Tu red WiFi (2,4 GHz)</span>
            <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="Nombre de tu red" autoComplete="off" />
            {/5\s*g/i.test(ssid) && (
              <small className={styles.alerta}>
                Este nombre parece de una red de 5 GHz: la ESP32 solo se conecta a redes de 2,4 GHz. Usa la otra red de tu router.
              </small>
            )}
          </label>
          <label>
            <span>Contraseña del WiFi</span>
            <span className={styles.clave}>
              <input type={verClave ? "text" : "password"} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
              <button type="button" onClick={() => setVerClave((v) => !v)}>{verClave ? "Ocultar" : "Ver"}</button>
            </span>
          </label>
          <label>
            <span>Servidor MQTT</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="mi-servidor.local" />
          </label>
          <label>
            <span>Puerto MQTT</span>
            <input value={puerto} onChange={(e) => setPuerto(e.target.value)} inputMode="numeric" />
          </label>
          <datalist id="placas">
            {devices.map((d) => <option key={d.id} value={d.id} />)}
          </datalist>
        </div>

        <div className={styles.qrs}>
          <figure className={styles.qr}>
            <figcaption><strong>Paso 1 · Conectarse a la placa</strong></figcaption>
            {qrRed ? <img src={qrRed} alt={`QR para unirse a la red ${red}`} /> : <div className={styles.vacio} />}
            <p className="muted">
              Únete a <code>{red || "—"}</code>. Si el móvil avisa de que la red no tiene internet, elige
              «Usar sin internet» o «Mantener conexión». No pulses «Cancelar» en la ventana que se abre sola.
            </p>
          </figure>

          <figure className={styles.qr}>
            <figcaption><strong>Paso 2 · Enviar la configuración</strong></figcaption>
            {qrConfig ? <img src={qrConfig} alt="QR con la configuración para la placa" /> : <div className={styles.vacio}>Falta {faltan.join(", ")}</div>}
            <p className="muted">
              Con el móvil aún conectado a la placa, escanéalo y abre el enlace. La placa guarda los datos y se conecta a tu
              WiFi. Desde un ordenador conectado a la red de la placa, usa el botón.
            </p>
            {enlaceConfig && (
              <a className={styles.boton} href={enlaceConfig} target="_blank" rel="noopener noreferrer">
                Enviar configuración a la placa
              </a>
            )}
          </figure>
        </div>
        <p className={styles.aviso}>
          El código del paso 2 contiene la contraseña de tu WiFi: no compartas capturas de esta página con él visible.
        </p>
      </section>
    </main>
  );
}
