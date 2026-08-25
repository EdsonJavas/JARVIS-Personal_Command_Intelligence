import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { BrainCircuit, Loader2, LockKeyhole } from "lucide-react";
import { TRPCClientError } from "@trpc/client";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { login, loginPending, isAuthenticated, loading } = useAuth();

  // Sessão já válida (cookie de um acesso anterior): não faz sentido pedir senha.
  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, loading, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || loginPending) return;

    setError(null);
    try {
      await login(password);
      navigate("/", { replace: true });
    } catch (loginError) {
      setError(
        loginError instanceof TRPCClientError
          ? loginError.message
          : "Não foi possível entrar. Tente novamente."
      );
      setPassword("");
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">
          <BrainCircuit size={22} />
        </div>

        <div className="login-heading">
          <span className="eyebrow">ACESSO LOCAL</span>
          <h1>JARVIS</h1>
          <p>Esta instalação é protegida por senha única definida no servidor.</p>
        </div>

        <label className="login-field">
          <span>SENHA</span>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={!password || loginPending}>
          {loginPending ? <Loader2 size={15} className="spin" /> : <LockKeyhole size={15} />}
          ENTRAR
        </button>
      </form>
    </main>
  );
}
