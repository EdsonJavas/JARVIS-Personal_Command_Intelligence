import { describe, expect, it } from "vitest";
import { lerAgenda, lerEmails, redigirBriefing } from "./hoje";

describe("ler agenda em texto livre", () => {
  it("entende o formato Title/Start/End/Location", () => {
    const eventos = lerAgenda(
      "Title: Reunião com cliente Lummy\nStart: 2026-08-26T11:00:00-03:00\nEnd: 2026-08-26T11:30:00-03:00\nLocation: Google Meet\n\nTitle: Dentista\nStart: 2026-08-26T18:00:00-03:00"
    );
    expect(eventos).toHaveLength(2);
    expect(eventos[0].titulo).toBe("Reunião com cliente Lummy");
    expect(eventos[0].inicio).toBe(new Date("2026-08-26T11:00:00-03:00").toISOString());
    expect(eventos[0].local).toBe("Google Meet");
    expect(eventos[1].fim).toBeNull();
  });

  it("formato desconhecido vira linha crua, nunca erro", () => {
    const eventos = lerAgenda("- 14:00 Revisar PR do imobx-front");
    expect(eventos).toHaveLength(1);
    expect(eventos[0].titulo).toBe("14:00 Revisar PR do imobx-front");
    expect(eventos[0].inicio).not.toBeNull();
    expect(eventos[0].cru).toContain("Revisar PR");
  });

  it("'no events' não vira evento", () => {
    expect(lerAgenda("No events found for this period.")).toEqual([]);
  });
});

describe("ler e-mails em texto livre", () => {
  it("separa remetente, assunto e o que pede resposta", () => {
    const emails = lerEmails(
      'From: "Marcos Silva" <marcos@lummy.com>\nSubject: Conseguimos antecipar a entrega?\nDate: 2026-08-26T10:01:00Z\nSnippet: Precisamos do módulo até sexta\n\nFrom: Nubank <noreply@nubank.com.br>\nSubject: Sua fatura fechou\nSnippet: R$ 2.340,10'
    );
    expect(emails).toHaveLength(2);
    expect(emails[0].de).toBe("Marcos Silva");
    expect(emails[0].pedeResposta).toBe(true);
    // Remetente automático nunca "pede resposta", mesmo com ponto de interrogação.
    expect(emails[1].pedeResposta).toBe(false);
  });
});

describe("redigir briefing", () => {
  const agora = new Date("2026-08-26T10:41:00-03:00");

  it("conta e aponta o próximo compromisso", () => {
    const texto = redigirBriefing({
      agora,
      eventos: [
        { titulo: "Daily", inicio: "2026-08-26T11:30:00.000Z", fim: null, local: null, cru: "" },
        { titulo: "Reunião Lummy", inicio: "2026-08-26T14:00:00.000Z", fim: null, local: null, cru: "" },
      ],
      emailsQuePedem: 3,
      reposComPendencia: 7,
      compromissos: 1,
    });
    expect(texto).toBe(
      "2 compromissos na agenda, o próximo em 19 min: Reunião Lummy. 3 e-mails pedem resposta. 7 repositórios com pendência. 1 lembrete marcado comigo."
    );
  });

  it("dia vazio é dito como vazio, sem zeros", () => {
    expect(redigirBriefing({ agora, eventos: [], emailsQuePedem: 0, reposComPendencia: 0, compromissos: 0 })).toBe(
      "Agenda livre hoje."
    );
  });
});
