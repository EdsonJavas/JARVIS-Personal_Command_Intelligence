import { describe, expect, it } from "vitest";
import { ehArriscada, type ServidorMcp } from "./ponte";

/**
 * A classificação de risco de ferramenta EXTERNA.
 *
 * Este teste existe por causa de algo que eu vi acontecer: ao ligar a ponte pela
 * primeira vez, um servidor MCP qualquer expôs `delete_entities` e ela entrou no
 * catálogo do Jarvis como leitura, sem confirmação — porque eu não a tinha
 * listado. Confiar por omissão no que não escrevi é o oposto da regra do projeto.
 */

const servidor = (extras: Partial<ServidorMcp> = {}): ServidorMcp => ({
  nome: "x",
  comando: "npx",
  ...extras,
});

describe("risco de ferramenta externa", () => {
  it.each([
    "delete_entities",
    "remove-event",
    "send_email",
    "trash_message",
    "update-event",
    "drop_table",
    "purge_cache",
    "overwrite_file",
    "rename-folder",
  ])("%s pede confirmação mesmo sem estar listada", (nome) => {
    expect(ehArriscada(servidor(), nome)).toBe(true);
  });

  it.each(["list_events", "get_message", "search_files", "read_document", "fetch_data"])(
    "%s passa direto: é leitura",
    (nome) => {
      expect(ehArriscada(servidor(), nome)).toBe(false);
    }
  );

  it("a lista explícita acrescenta ao que o nome não denuncia", () => {
    // "export" não soa destrutivo e pode vazar a agenda inteira.
    expect(ehArriscada(servidor(), "export_all")).toBe(false);
    expect(ehArriscada(servidor({ arriscadas: ["export_all"] }), "export_all")).toBe(true);
  });

  it("a lista de seguras vence o classificador", () => {
    // Sem esta saída, "create-event" pediria confirmação a cada compromisso
    // marcado e a agenda viraria estorvo.
    expect(ehArriscada(servidor(), "update-profile")).toBe(true);
    expect(ehArriscada(servidor({ seguras: ["update-profile"] }), "update-profile")).toBe(false);
  });

  it("verbo dentro de palavra maior não conta", () => {
    // "sender" contém "send" e não envia nada; "deleted_count" só informa.
    expect(ehArriscada(servidor(), "get_sender")).toBe(false);
    expect(ehArriscada(servidor(), "deleted_count")).toBe(false);
  });
});
