import type { CSSProperties } from "react";
import s from "./jardin.module.css";

// Fondo decorativo: cielo soleado, nubes, colinas, hierba, flores y mariposas.
// Va fijo detrás de todas las páginas y no recibe clics.

// Pseudoaleatorio determinista: el mismo dibujo en el servidor y en el navegador.
const azar = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const HIERBA = Array.from({ length: 72 }, (_, i) => {
  const x = i * 20 + azar(i) * 14;
  const alto = 22 + azar(i + 100) * 26;
  const curva = (azar(i + 200) - 0.5) * 14;
  return { x, alto, curva, retraso: -azar(i + 300) * 3, tono: azar(i + 400) > 0.5 ? "#4f9a3a" : "#3f8530" };
});

const FLORES = [
  { x: 90, alto: 58, color: "#f26b8a" },
  { x: 260, alto: 44, color: "#ffd23f" },
  { x: 420, alto: 64, color: "#b07ce8" },
  { x: 610, alto: 50, color: "#ff8f4a" },
  { x: 790, alto: 60, color: "#f26b8a" },
  { x: 980, alto: 46, color: "#ffd23f" },
  { x: 1150, alto: 62, color: "#7cc0f2" },
  { x: 1330, alto: 52, color: "#ff8f4a" },
];

const SUELO = 362; // línea de la tierra en el dibujo (viewBox 1440 x 400)

function Nube() {
  return (
    <svg viewBox="0 0 120 50">
      <g fill="#ffffff">
        <circle cx="30" cy="32" r="16" />
        <circle cx="52" cy="22" r="20" />
        <circle cx="76" cy="28" r="17" />
        <circle cx="94" cy="34" r="12" />
        <rect x="22" y="30" width="80" height="18" rx="9" />
      </g>
    </svg>
  );
}

function Mariposa({ color }: { color: string }) {
  return (
    <g>
      <g className={s.alas}>
        <ellipse cx="-7" cy="-3" rx="8" ry="6" fill={color} />
        <ellipse cx="7" cy="-3" rx="8" ry="6" fill={color} />
        <ellipse cx="-5" cy="5" rx="5" ry="4" fill={color} opacity="0.85" />
        <ellipse cx="5" cy="5" rx="5" ry="4" fill={color} opacity="0.85" />
      </g>
      <rect x="-1.2" y="-7" width="2.4" height="15" rx="1.2" fill="#3b2a1c" />
    </g>
  );
}

export default function JardinFondo() {
  return (
    <div className={s.fondo} aria-hidden="true">
      <svg className={s.sol} viewBox="0 0 200 200">
        <circle className={s.brillo} cx="100" cy="100" r="62" fill="#ffe9a3" />
        <g className={s.rayos} stroke="#ffc83d" strokeWidth="7" strokeLinecap="round">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="100" y1="22" x2="100" y2="40" transform={`rotate(${i * 30} 100 100)`} />
          ))}
        </g>
        <circle cx="100" cy="100" r="40" fill="#ffcf4a" />
      </svg>

      <div className={`${s.nube} ${s.nube1}`}><Nube /></div>
      <div className={`${s.nube} ${s.nube2}`}><Nube /></div>
      <div className={`${s.nube} ${s.nube3}`}><Nube /></div>

      <svg className={s.jardin} viewBox="0 0 1440 400" preserveAspectRatio="xMidYMax slice">
        {/* Colinas */}
        <path d="M0 250 Q 220 170 460 230 T 940 215 T 1440 205 V400 H0 Z" fill="#a9d483" />
        <path d="M0 300 Q 300 238 640 292 T 1440 280 V400 H0 Z" fill="#7cbf5e" />
        {/* Tierra */}
        <path d={`M0 ${SUELO} Q 360 ${SUELO - 8} 720 ${SUELO} T 1440 ${SUELO} V400 H0 Z`} fill="#7a5232" />

        {/* Hierba */}
        {HIERBA.map((h, i) => (
          <path
            key={i}
            className={s.hierba}
            style={{ animationDelay: `${h.retraso}s` } as CSSProperties}
            d={`M${h.x} ${SUELO + 2} q ${h.curva} ${-h.alto / 2} ${h.curva / 2} ${-h.alto}`}
            stroke={h.tono}
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
        ))}

        {/* Flores */}
        {FLORES.map((f, i) => (
          <g key={i} className={s.flor} style={{ animationDelay: `${-i * 0.7}s` } as CSSProperties}>
            <path d={`M${f.x} ${SUELO + 2} q 6 ${-f.alto / 2} 0 ${-f.alto}`} stroke="#3f8530" strokeWidth="4" fill="none" />
            <ellipse cx={f.x + 9} cy={SUELO - f.alto / 2} rx="8" ry="4" fill="#4f9a3a" transform={`rotate(-30 ${f.x + 9} ${SUELO - f.alto / 2})`} />
            {Array.from({ length: 6 }, (_, p) => (
              <circle
                key={p}
                cx={f.x + Math.cos((p * Math.PI) / 3) * 9}
                cy={SUELO - f.alto + Math.sin((p * Math.PI) / 3) * 9}
                r="7"
                fill={f.color}
              />
            ))}
            <circle cx={f.x} cy={SUELO - f.alto} r="6" fill="#ffe066" stroke="#e0a800" strokeWidth="1.5" />
          </g>
        ))}

        {/* Mariposas */}
        <g className={`${s.mariposa} ${s.mariposa1}`}>
          <Mariposa color="#ff9ec0" />
        </g>
        <g className={`${s.mariposa} ${s.mariposa2}`}>
          <Mariposa color="#9fd4ff" />
        </g>
      </svg>
    </div>
  );
}
