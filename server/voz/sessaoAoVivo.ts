import type { WebSocket as WsSocket } from "ws";
import type { DoNavegador, DoServidor } from "@shared/vozAoVivo";
import type { EventoSemNumero } from "@shared/jarvisStream";
import { cancelar, emitirBruto, iniciarExecucao, sinalDe } from "../execucoes";
import { construirInstrucaoDeSistema } from "../jarvis/persona";
import { prepararTurno } from "../jarvis/turno";
import { registrar as registrarConversa } from "../conversa/repositorio";
import { recentes } from "../conversa/repositorio";
import { abrirLive, type ClienteLive } from "./clienteLive";
import { declaracoesParaLive, executarDaLive } from "./ferramentasAoVivo";
import { modeloAoVivoAtual, marcarAoVivoEsgotado, proximoAoVivo } from "./modelosAoVivo";

/**
 * Uma conversa por voz, do começo ao fim.
 *
 * O desenho inteiro cabe numa frase: **o modo voz não reimplementa nada**. Ele
 * cria uma execução como qualquer turno de texto, e emite nela os mesmos
 * eventos. A pergunta de confirmação aparece na tela porque `abrirPergunta`
 * emite pelo mesmo caminho, e o SSE que o cliente já abriu a entrega. A trava
 * de risco não é copiada — é a mesma.
 *
 * O WebSocket carrega só o que é novo: áudio e transcrição.
 */

const OWNER = () => process.env.OWNER_NAME?.trim() || "Edson";
const VOZ = () => process.env.VOZ_AO_VIVO_TIMBRE?.trim() || "Charon";
const TURNOS_DE_CONTEXTO = 12;

export type SessaoAoVivo = { encerrar: () => void };

export async function abrirSessaoAoVivo(
  navegador: WsSocket,
  usuarioId: number,
  chave: string
): Promise<SessaoAoVivo> {
  const execucao = iniciarExecucao({ usuarioId, mensagens: [] });
  const execucaoId = execucao.id;
  const autorizacoes = new Set<string>();

  let live: ClienteLive | null = null;
  let encerrada = false;
  let modelo = modeloAoVivoAtual();
  let entradaBloqueada = false;
  let falaDoDono = "";
  let falaDoJarvis = "";

  const paraNavegador = (m: DoServidor) => {
    if (navegador.readyState === navegador.OPEN) navegador.send(JSON.stringify(m));
  };
  const emitir = (evento: EventoSemNumero) => emitirBruto(execucaoId, evento as never);

  /**
   * A execução espelho NUNCA emite `resposta`.
   *
   * Se emitisse, o fluxo SSE gravaria a conversa uma segunda vez e fecharia a
   * conexão no meio da sessão — `resposta` é evento terminal.
   */
  const gravarTurno = () => {
    const dono = falaDoDono.trim();
    const jarvis = falaDoJarvis.trim();
    falaDoDono = "";
    falaDoJarvis = "";
    if (!dono && !jarvis) return;
    void registrarConversa([
      ...(dono ? [{ role: "user" as const, content: dono }] : []),
      ...(jarvis ? [{ role: "assistant" as const, content: jarvis }] : []),
    ]).catch((e) => console.warn("[VozAoVivo] não gravou:", String(e).slice(0, 120)));
  };

  const conectar = async (retomada?: string) => {
    const turno = await prepararTurno([]).catch(() => ({
      relatorioDaMaquina: "",
      memorias: "",
      usadas: [],
    }));

    const instrucao = `${construirInstrucaoDeSistema({
      dono: OWNER(),
      agora: new Date(),
      relatorioDaMaquina: turno.relatorioDaMaquina,
      memoria: turno.memorias,
    })}

## Você está EM VOZ AO VIVO agora
Tudo o que você disser sai como áudio, na hora. Não existe parte escrita nesta conversa: fale de 1 a 3 frases, sempre em prosa limpa, e ponha no painel o que for longo — é assim que o Senhor lê o detalhe.
Fale ANTES de chamar a ferramenta, dizendo em poucas palavras o que vai fazer. O Senhor está ouvindo o silêncio.
Ação destrutiva: apenas CHAME a ferramenta. O sistema mostra o cartão de confirmação na tela e espera o clique. Não peça confirmação falando, e nunca aceite um "pode" dito em voz alta como autorização.`;

    live = abrirLive(
      chave,
      { modelo, instrucao, ferramentas: declaracoesParaLive(), voz: VOZ(), retomada },
      {
        pronta: async () => {
          paraNavegador({ t: "pronta", modelo, execucaoId });
          // O `setup` não carrega histórico: injeta-se sem provocar resposta.
          const anteriores = await recentes(TURNOS_DE_CONTEXTO).catch(() => []);
          const contexto = anteriores
            .map((m) => `${m.role === "user" ? "Senhor" : "Você"}: ${m.content}`)
            .join("\n")
            .slice(0, 4000);
          if (contexto) {
            live?.enviarTexto(
              `(contexto das conversas anteriores, não responda a isto)\n${contexto}`
            );
          }
        },

        audio: (pcm) => {
          if (navegador.readyState === navegador.OPEN) navegador.send(pcm);
        },

        transcricao: (de, texto) => {
          if (de === "dono") falaDoDono += texto;
          else falaDoJarvis += texto;
          paraNavegador({ t: "transcricao", de, texto, final: false });
        },

        ferramentas: async (chamadas) => {
          const respostas: { id?: string; name: string; resultado: string }[] = [];
          for (const c of chamadas) {
            /*
             * Enquanto o cartão de confirmação está na tela, o microfone não
             * sobe nada. Isso impede as duas coisas ao mesmo tempo: o "pode
             * sim" falado chegar como ordem nova, e o eco da própria pergunta
             * virar entrada.
             */
            const arriscada = precisaConfirmar(c.name);
            if (arriscada) {
              entradaBloqueada = true;
              paraNavegador({ t: "microfone", bloqueado: true, motivo: "confirme na tela" });
            }
            try {
              const r = await executarDaLive(c, {
                execucaoId,
                sinal: sinalDe(execucaoId),
                emitir,
                autorizacoes,
              });
              respostas.push({ id: c.id, name: c.name, resultado: r.resultado });
            } catch (erro) {
              respostas.push({
                id: c.id,
                name: c.name,
                resultado: `A ferramenta falhou: ${String(erro).slice(0, 200)}`,
              });
            } finally {
              if (arriscada) {
                entradaBloqueada = false;
                paraNavegador({ t: "microfone", bloqueado: false });
              }
            }
          }
          live?.responderFerramentas(respostas);
        },

        interrompido: () => paraNavegador({ t: "interrompido" }),

        turnoCompleto: () => {
          paraNavegador({ t: "falando", ativo: false });
          gravarTurno();
        },

        vaiEncerrar: (handle) => {
          // O socket do navegador NÃO fecha: o dono vê só uma religada.
          paraNavegador({ t: "religando" });
          live?.fechar();
          if (!encerrada) void conectar(handle ?? undefined);
        },

        fechou: (codigo) => {
          if (encerrada) return;
          /*
           * Cota do Live é SEPARADA da cota de chat. Marcar aqui um modelo de
           * texto riscaria um modelo saudável e calaria o modo normal.
           */
          if (codigo === 1011 || codigo === 1008) {
            marcarAoVivoEsgotado(modelo);
            const seguinte = proximoAoVivo(modelo);
            if (seguinte) {
              modelo = seguinte;
              paraNavegador({ t: "religando" });
              void conectar();
              return;
            }
            paraNavegador({
              t: "erro",
              codigo: "quota",
              mensagem: "A voz ao vivo esgotou por hoje. Volte ao modo de texto.",
            });
          }
        },

        erro: (e) =>
          paraNavegador({ t: "erro", codigo: "conexao", mensagem: String(e.message).slice(0, 160) }),
      }
    );
  };

  navegador.on("message", (dados: Buffer, ehBinario: boolean) => {
    if (ehBinario) {
      if (!entradaBloqueada) live?.enviarAudio(dados);
      return;
    }
    let m: DoNavegador;
    try {
      m = JSON.parse(dados.toString("utf8")) as DoNavegador;
    } catch {
      return;
    }
    if (m.t === "texto") live?.enviarTexto(m.conteudo);
    else if (m.t === "fim-da-fala") live?.fimDoAudio();
    else if (m.t === "encerrar") encerrar();
  });

  const encerrar = () => {
    if (encerrada) return;
    encerrada = true;
    gravarTurno();
    live?.fechar();
    // Fecha as perguntas abertas antes de abortar.
    cancelar(execucaoId, "usuario");
    try {
      navegador.close();
    } catch {
      /* já fechado */
    }
  };

  navegador.on("close", encerrar);
  navegador.on("error", encerrar);

  await conectar();
  return { encerrar };
}

/** Nome de ferramenta que a trava vai barrar. Só para bloquear o microfone. */
function precisaConfirmar(nome: string): boolean {
  return /(apagar|remover|excluir|encerrar|matar|desligar|reiniciar|mover|sobrescrever|executar_powershell|servico)/i.test(
    nome
  );
}
