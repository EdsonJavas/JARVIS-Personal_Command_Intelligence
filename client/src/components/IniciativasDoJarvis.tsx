import { BellRing, CalendarClock, TriangleAlert, X } from "lucide-react";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";

/**
 * O que o Jarvis veio dizer por conta própria.
 *
 * Ele já falou em voz alta quando isto chegou, mas voz some. Um lembrete que
 * tocou enquanto o dono estava fora da sala não pode simplesmente deixar de
 * existir — fica aqui até ele dispensar.
 */

const ICONES = {
  lembrete: BellRing,
  rotina: CalendarClock,
  vigia: TriangleAlert,
} as const;

const ROTULOS = {
  lembrete: "LEMBRETE",
  rotina: "ROTINA",
  vigia: "ATENÇÃO",
} as const;

function haQuantoTempo(em: number): string {
  const segundos = Math.max(0, Math.round((Date.now() - em) / 1000));
  if (segundos < 60) return "agora";
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
  return `há ${Math.floor(segundos / 3600)} h`;
}

export function IniciativasDoJarvis() {
  const { iniciativas, dispensarIniciativa } = useJarvisSession();
  if (iniciativas.length === 0) return null;

  return (
    <div className="iniciativas" role="status" aria-live="polite">
      {iniciativas.map((iniciativa) => {
        const Icone = ICONES[iniciativa.tipo];
        return (
          <article key={`${iniciativa.compromissoId}-${iniciativa.em}`} className={`iniciativa tipo-${iniciativa.tipo}`}>
            <Icone size={13} />
            <div>
              <header>
                <b>{ROTULOS[iniciativa.tipo]}</b>
                <em>{haQuantoTempo(iniciativa.em)}</em>
              </header>
              <p>{iniciativa.texto}</p>
              {iniciativa.valor !== undefined ? (
                <small>medido: {Math.round(iniciativa.valor)}%</small>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dispensarIniciativa(iniciativa.compromissoId)}
              aria-label="Dispensar"
              title="Dispensar"
            >
              <X size={12} />
            </button>
          </article>
        );
      })}
    </div>
  );
}
