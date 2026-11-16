import { useEffect, useRef, useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { TRPCClientError } from "@trpc/client";
import { useAuth } from "@/_core/hooks/useAuth";
import { JarvisSessionProvider } from "@/contexts/JarvisSessionContext";
import { CascaDaIlha, useAbertura } from "@/components/ilha/CascaDaIlha";
import { IlhaDinamica } from "@/components/ilha/IlhaDinamica";
import { SESSAO_EXPIROU_NA_ILHA, TITULOS } from "@/const";
import "@/ilha.css";

/**
 * A ilha: o Jarvis no alto da tela, sempre à mão.
 *
 * Esta página é carregada pelo app de mesa numa janela transparente, sem borda
 * e sempre por cima. Fora dele, abre num navegador comum para desenvolvimento.
 *
 * A entrada por senha acontece DENTRO da ilha. A tela de login de sempre ocupa
 * a janela inteira com fundo escuro — na janela transparente, isso viraria um
 * retângulo preto cobrindo o alto da tela.
 */
export default function Ilha() {
  useEffect(() => {
    document.title = TITULOS.ilha;
  }, []);
  const { user, loading, login, loginPending, refresh } = useAuth();

  // Uma consulta protegida voltou "não autenticado": a sessão expirou com a
  // ilha aberta. Confere de novo, e a ilha volta a pedir a senha.
  useEffect(() => {
    const aoExpirar = () => void refresh();
    window.addEventListener(SESSAO_EXPIROU_NA_ILHA, aoExpirar);
    return () => window.removeEventListener(SESSAO_EXPIROU_NA_ILHA, aoExpirar);
  }, [refresh]);

  if (loading) {
    return (
      <CascaDaIlha forma="repouso" chave="carregando" rotulo="JARVIS, iniciando">
        <div className="ilha-repouso">
          <span className="ilha-ponto apagado" aria-hidden="true" />
          <span className="ilha-marca">JARVIS</span>
          <span className="ilha-contagem vazia" aria-hidden="true" />
        </div>
      </CascaDaIlha>
    );
  }

  if (!user) return <IlhaEntrar login={login} pendente={loginPending} />;

  return (
    <JarvisSessionProvider origem="ilha">
      <IlhaDinamica />
    </JarvisSessionProvider>
  );
}

function IlhaEntrar({
  login,
  pendente,
}: {
  login: (senha: string) => Promise<unknown>;
  pendente: boolean;
}) {
  const { aberta, abrir } = useAbertura();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberta) requestAnimationFrame(() => campoRef.current?.focus({ preventScroll: true }));
  }, [aberta]);

  const entrar = async () => {
    if (!senha || pendente) return;
    setErro(null);
    try {
      await login(senha);
    } catch (falha) {
      setErro(falha instanceof TRPCClientError ? falha.message : "Não consegui entrar.");
      setSenha("");
    }
  };

  return (
    <CascaDaIlha
      forma={aberta ? "expandida" : "repouso"}
      chave={aberta ? "entrar" : "trancada"}
      rotulo="JARVIS, entrar"
      aoClicar={abrir}
    >
      {aberta ? (
        <form
          className="ilha-entrar"
          onSubmit={(evento) => {
            evento.preventDefault();
            void entrar();
          }}
        >
          <header>
            <LockKeyhole size={14} />
            <b>Acesso local</b>
          </header>
          <p>A senha do APP_PASSWORD, no .env do servidor. A sessão fica guardada aqui.</p>
          <div className="ilha-composer">
            <input
              ref={campoRef}
              type="password"
              value={senha}
              autoComplete="current-password"
              placeholder="Senha"
              onChange={(evento) => setSenha(evento.target.value)}
            />
            <button type="submit" className="ilha-enviar largo" disabled={!senha || pendente}>
              {pendente ? <Loader2 size={14} className="spin" /> : "Entrar"}
            </button>
          </div>
          {erro ? (
            <p className="ilha-erro-linha" role="alert">
              {erro}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="ilha-repouso">
          <LockKeyhole size={12} className="ilha-cadeado" />
          <span className="ilha-marca">JARVIS</span>
          <span className="ilha-contagem vazia" aria-hidden="true" />
        </div>
      )}
    </CascaDaIlha>
  );
}
