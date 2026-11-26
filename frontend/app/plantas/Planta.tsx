import styles from "./plantas.module.css";

export type Animo = "feliz" | "sed" | "calor" | "sofocada";

type Props = {
  /** false = ningún sensor funciona: la maceta aparece vacía. */
  presente: boolean;
  animo: Animo;
  /** Humedad de tierra (%) para el color de la tierra; null si no hay lectura. */
  tierra: number | null;
};

function colorTierra(tierra: number | null) {
  if (tierra == null) return "#6b5444";
  if (tierra < 30) return "#b08a5a";
  if (tierra > 70) return "#3e2a1c";
  return "#5b3d27";
}

const TALLO = "#4e9a3a";
const HOJA = "#69b84c";
const BORDE_HOJA = "#3f7f2e";
const CARA = "#1f2a1a";

export default function Planta({ presente, animo, tierra }: Props) {
  const cabeza = animo === "sed" ? "#a3b86a" : animo === "sofocada" ? "#6fb59a" : "#7cc35a";

  return (
    <svg viewBox="0 0 200 220" className={`${styles.svg} ${styles[animo] ?? ""}`} role="img"
      aria-label={presente ? `Planta ${animo}` : "Maceta vacía"}>
      {/* Tierra (detrás del borde de la maceta) */}
      <ellipse cx="100" cy="142" rx="52" ry="7" fill={colorTierra(tierra)} />
      {tierra != null && tierra < 30 && (
        <g stroke="#8a6a42" strokeWidth="1" fill="none" strokeLinecap="round">
          <path d="M70 142 L76 140 L80 143" />
          <path d="M112 141 L118 143 L124 140" />
        </g>
      )}

      {presente ? (
        <g className={styles.pose}>
          <g className={styles.balanceo}>
            <path d="M100 142 C100 122 101 106 100 96" stroke={TALLO} strokeWidth="6" strokeLinecap="round" fill="none" />
            <g className={styles.hojaIzq}>
              <path d="M100 122 C82 106 64 110 58 122 C72 131 88 130 100 122 Z" fill={HOJA} stroke={BORDE_HOJA} strokeWidth="1.5" />
            </g>
            <g className={styles.hojaDer}>
              <path d="M100 112 C118 97 136 101 142 113 C128 122 112 120 100 112 Z" fill={HOJA} stroke={BORDE_HOJA} strokeWidth="1.5" />
            </g>

            {/* Cabeza */}
            <path d="M100 42 C103 31 113 28 119 32 C115 41 106 44 100 42 Z" fill={HOJA} stroke={BORDE_HOJA} strokeWidth="1.5" />
            <circle cx="100" cy="70" r="30" fill={cabeza} stroke={BORDE_HOJA} strokeWidth="2" />
            <Cara animo={animo} />
          </g>
        </g>
      ) : (
        <g className={styles.cartel}>
          <rect x="118" y="100" width="4" height="44" rx="1" fill="#8a6a42" />
          <rect x="100" y="86" width="40" height="28" rx="4" fill="#e9d8b4" stroke="#8a6a42" strokeWidth="1.5" />
          <text x="120" y="106" textAnchor="middle" fontSize="18" fontWeight="700" fill="#8a6a42">?</text>
        </g>
      )}

      {/* Maceta */}
      <rect x="44" y="140" width="112" height="16" rx="4" fill="#c9653d" />
      <path d="M52 156 L148 156 L139 210 Q138 214 134 214 L66 214 Q62 214 61 210 Z" fill="#b5532f" />
      <path d="M58 170 L142 170" stroke="#a3482a" strokeWidth="2" />
    </svg>
  );
}

function Cara({ animo }: { animo: Animo }) {
  return (
    <g>
      {/* Ojos */}
      {animo === "sofocada" ? (
        <g stroke={CARA} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M84 62 L92 66 L84 70" />
          <path d="M116 62 L108 66 L116 70" />
        </g>
      ) : animo === "sed" ? (
        <g stroke={CARA} strokeWidth="2.5" strokeLinecap="round" fill="none">
          <path d="M84 66 Q89 70 94 66" />
          <path d="M106 66 Q111 70 116 66" />
        </g>
      ) : (
        <g fill={CARA}>
          <ellipse className={styles.ojo} cx="89" cy="65" rx="3.5" ry="4.5" />
          <ellipse className={styles.ojo} cx="111" cy="65" rx="3.5" ry="4.5" />
        </g>
      )}

      {/* Mejillas */}
      <circle cx="80" cy="77" r={animo === "calor" ? 6 : animo === "sofocada" ? 7 : 4}
        fill={animo === "calor" ? "#ff5a4f" : "#f28b9b"} opacity={animo === "calor" ? 0.75 : 0.6} />
      <circle cx="120" cy="77" r={animo === "calor" ? 6 : animo === "sofocada" ? 7 : 4}
        fill={animo === "calor" ? "#ff5a4f" : "#f28b9b"} opacity={animo === "calor" ? 0.75 : 0.6} />

      {/* Boca */}
      {animo === "feliz" && <path d="M92 78 Q100 87 108 78" stroke={CARA} strokeWidth="2.5" strokeLinecap="round" fill="none" />}
      {animo === "sed" && (
        <g>
          <path d="M92 80 Q100 76 108 80 Q100 90 92 80 Z" fill={CARA} />
          <ellipse className={styles.lengua} cx="100" cy="87" rx="4" ry="4" fill="#f27b8c" />
        </g>
      )}
      {animo === "calor" && <path className={styles.jadeo} d="M92 79 Q100 93 108 79 Z" fill="#7a1f1f" />}
      {animo === "sofocada" && (
        <path d="M91 83 Q95.5 79 100 83 Q104.5 87 109 83" stroke={CARA} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      )}

      {/* Efectos según el ánimo */}
      {animo === "sed" && (
        <g className={styles.burbuja}>
          <circle cx="132" cy="44" r="3" fill="#fff" stroke="#9db7cc" strokeWidth="1" />
          <circle cx="141" cy="33" r="5" fill="#fff" stroke="#9db7cc" strokeWidth="1" />
          <circle cx="162" cy="18" r="15" fill="#fff" stroke="#9db7cc" strokeWidth="1" />
          <path d="M162 8 C157 15 156 19 162 25 C168 19 167 15 162 8 Z" fill="#4aa3e0" />
        </g>
      )}
      {animo === "calor" && (
        <g>
          <path className={`${styles.sudor} ${styles.sudor1}`} d="M127 52 C124 57 123 60 127 62 C131 60 130 57 127 52 Z" fill="#5fb4f0" />
          <path className={`${styles.sudor} ${styles.sudor2}`} d="M73 55 C70 60 69 63 73 65 C77 63 76 60 73 55 Z" fill="#5fb4f0" />
          <g className={styles.sol}>
            <circle cx="172" cy="26" r="10" fill="#ffc43d" />
            <g stroke="#ffc43d" strokeWidth="3" strokeLinecap="round">
              <path d="M172 8 V4" /><path d="M172 44 V48" /><path d="M154 26 H150" /><path d="M190 26 H194" />
              <path d="M159 13 L156 10" /><path d="M185 39 L188 42" /><path d="M185 13 L188 10" /><path d="M159 39 L156 42" />
            </g>
          </g>
        </g>
      )}
      {animo === "sofocada" && (
        <g fill="#c3d2df">
          <g className={`${styles.vapor} ${styles.vapor1}`}>
            <circle cx="60" cy="52" r="6" /><circle cx="67" cy="48" r="7" /><circle cx="74" cy="53" r="5" />
          </g>
          <g className={`${styles.vapor} ${styles.vapor2}`}>
            <circle cx="132" cy="40" r="6" /><circle cx="139" cy="36" r="7" /><circle cx="146" cy="41" r="5" />
          </g>
          <g className={`${styles.vapor} ${styles.vapor3}`}>
            <circle cx="150" cy="78" r="4" /><circle cx="156" cy="75" r="5" /><circle cx="161" cy="79" r="4" />
          </g>
        </g>
      )}
    </g>
  );
}
