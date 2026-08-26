import type { ServidorMcp } from "./ponte";

/**
 * Quais servidores MCP o Jarvis conecta.
 *
 * Fica em código, e não num JSON solto, porque a lista de ferramentas
 * ARRISCADAS é decisão de projeto, não configuração: o servidor MCP não sabe o
 * que é grave para o dono, e o modelo não pode decidir isso sozinho. Enviar
 * e-mail ou apagar evento tem que passar pela confirmação.
 *
 * Cada servidor só entra se a credencial dele estiver no `.env`. Assim uma
 * instalação sem Google simplesmente não vê essas ferramentas, em vez de
 * mostrá-las e falhar quando forem usadas — o que faria o Jarvis prometer algo
 * que não consegue cumprir.
 */

function temGoogle(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}

function temGitHub(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}

export function servidoresConfigurados(): ServidorMcp[] {
  const lista: ServidorMcp[] = [];

  if (temGitHub()) {
    lista.push({
      nome: "github",
      /*
       * O servidor oficial de referência do protocolo. Tudo o que o token do
       * dono alcança, o Jarvis alcança: repositórios, issues, pull requests,
       * conteúdo de arquivo, busca de código.
       */
      comando: "npx",
      argumentos: ["-y", "@modelcontextprotocol/server-github"],
      ambiente: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? "" },
      /*
       * Ler é o uso normal e passa direto. Escrever num repositório — subir
       * arquivo, abrir ou mesclar pull request, criar repositório ou fork —
       * fica visível para outras pessoas e não tem volta simples: confirma.
       * Issue e comentário são conversa, não código: passam.
       */
      arriscadas: [
        "create_or_update_file",
        "push_files",
        "create_repository",
        "fork_repository",
        "create_branch",
        "create_pull_request",
        "merge_pull_request",
        "create_pull_request_review",
      ],
      seguras: ["create_issue", "add_issue_comment", "update_issue"],
    });
  }

  if (temGoogle()) {
    lista.push({
      nome: "agenda",
      comando: "npx",
      argumentos: ["-y", "@cocal/google-calendar-mcp"],
      ambiente: {
        GOOGLE_OAUTH_CREDENTIALS: process.env.GOOGLE_OAUTH_CREDENTIALS ?? "",
      },
      /*
       * Criar e ler evento passa direto: é o uso normal, e pedir confirmação a
       * cada consulta tornaria a agenda inútil. Apagar e atualizar não — são as
       * duas que destroem algo que já estava marcado.
       */
      arriscadas: ["delete-event", "update-event"],
      // O classificador por nome acusa "create-event" e "list-events" pelo
      // verbo; aqui eles são o uso normal, e confirmar cada consulta tornaria a
      // agenda inútil.
      seguras: ["create-event", "list-events", "list-calendars", "search-events", "get-event", "get-freebusy"],
    });

    lista.push({
      nome: "email",
      /*
       * `@mcp-z/mcp-gmail` foi a primeira escolha e não serve no Windows.
       *
       * Ele monta a URI do armazenamento como `file://` mais o caminho absoluto
       * — o que já produz URL malformada — e depois resolve por `url.pathname`
       * em vez de `fileURLToPath`. O caminho sai com a letra do disco duplicada
       * e o processo morre no arranque, com QUALQUER formato de entrada. Não há
       * variável de ambiente que contorne.
       */
      comando: "npx",
      argumentos: ["-y", "@gongrzhe/server-gmail-autoauth-mcp"],
      /*
       * Este lê a credencial de `~/.gmail-mcp/gcp-oauth.keys.json`, e não de
       * variável de ambiente. `npm run google:configurar` põe o arquivo lá.
       */
      arriscadas: ["send_email"],
      // O classificador por nome já acusa delete, modify e batch_delete; e
      // acerta ao deixar passar draft, read, search e list. Só o envio precisa
      // ser dito por extenso, por ser o único que não tem volta nenhuma.
    });
  }

  return lista;
}

/** Explica ao dono por que não há ferramentas do Google, quando não há. */
export function motivoDeAusencia(): string | null {
  const faltas: string[] = [];
  if (!temGoogle()) {
    faltas.push(
      "Agenda e e-mail não estão ligados: falta GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env. " +
        "Rode `npm run google:configurar` para o passo a passo."
    );
  }
  if (!temGitHub()) {
    faltas.push(
      "GitHub não está ligado: falta GITHUB_TOKEN no .env. " +
        "Crie um token em https://github.com/settings/tokens com os escopos repo, read:org e read:user."
    );
  }
  return faltas.length ? faltas.join(" ") : null;
}
