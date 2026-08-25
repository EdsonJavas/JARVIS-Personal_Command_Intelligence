import { describe, expect, it } from "vitest";
import {
  classificarAbrirCaminho,
  classificarAbrirPrograma,
  classificarComandoPowerShell,
  classificarEncerrarProcesso,
  processoCritico,
} from "./risco";

describe("classificar comando PowerShell", () => {
  it.each([
    ["Remove-Item C:\\temp\\x -Recurse", "destrutivo"],
    ["rm -r ./build", "destrutivo"],
    ["del arquivo.txt", "destrutivo"],
    ["Move-Item a b", "destrutivo"],
    ["Rename-Item a b", "destrutivo"],
    ["Stop-Process -Name notepad", "destrutivo"],
    ["taskkill /PID 123 /F", "destrutivo"],
    ["Set-Content -Path x -Value y", "destrutivo"],
    ["Get-Date > saida.txt", "destrutivo"],
    ["Stop-Computer", "critico"],
    ["Restart-Computer -Force", "critico"],
    ["shutdown /s /t 0", "critico"],
    ["Format-Volume -DriveLetter D", "critico"],
    ["Clear-Disk -Number 1", "critico"],
    ["reg delete HKCU\\Software\\X", "critico"],
    ["Stop-Service -Name spooler", "critico"],
  ])("%s é %s", (comando, nivel) => {
    const avaliacao = classificarComandoPowerShell(comando);
    expect(avaliacao).not.toBeNull();
    expect(avaliacao?.nivel).toBe(nivel);
  });

  it.each([
    "Get-Process",
    "Get-ChildItem -Path C:\\ -Recurse",
    "Test-Path C:\\temp",
    "Get-Content arquivo.txt",
    "Get-Date >> registro.txt",
  ])("%s não exige confirmação", (comando) => {
    expect(classificarComandoPowerShell(comando)).toBeNull();
  });

  it("-WhatIf rebaixa, porque simula sem executar", () => {
    expect(classificarComandoPowerShell("Remove-Item x -WhatIf")).toBeNull();
  });

  it("-WhatIf:$false NÃO rebaixa — aquilo DESLIGA a simulação", () => {
    // O furo mais perigoso que apareceu: `\s-WhatIf\b` casava com `-WhatIf:$false`
    // e zerava o risco, então dava para apagar de verdade sem pergunta nenhuma.
    for (const comando of [
      "Remove-Item C:\\dados -Recurse -Force -WhatIf:$false",
      "Remove-Item C:\\dados -WhatIf:0",
      "Remove-Item C:\\dados -WhatIf: $false",
    ]) {
      expect(classificarComandoPowerShell(comando), comando).not.toBeNull();
    }
  });

  it("-WhatIf num trecho não protege o trecho destrutivo ao lado", () => {
    // Antes, um -WhatIf em qualquer canto rebaixava o comando inteiro.
    const avaliacao = classificarComandoPowerShell(
      "Get-ChildItem C:\\temp -WhatIf; Remove-Item C:\\dados -Recurse -Force"
    );
    expect(avaliacao).not.toBeNull();
    expect(avaliacao?.chave).toBe("powershell:remover");
  });

  it("simulação de verdade em todos os trechos continua rebaixando", () => {
    expect(
      classificarComandoPowerShell("Remove-Item a -WhatIf; Remove-Item b -WhatIf")
    ).toBeNull();
  });

  it("apelidos destrutivos não escapam", () => {
    // Quem digita `mv` sobrescreve o destino igual a quem digita `Move-Item`.
    for (const comando of [
      "mv C:\\a C:\\b",
      "ren arquivo.txt outro.txt",
      "kill -Name node",
      "spps -Name node",
      "New-Item relatorio.txt -Force",
      "copy C:\\a C:\\b",
    ]) {
      expect(classificarComandoPowerShell(comando), comando).not.toBeNull();
    }
  });

  it("-Confirm:$false NÃO rebaixa", () => {
    // Aquilo desliga o aviso do próprio PowerShell, que é outro portão — e é
    // justamente o sinal de que quem escreveu quer evitar perguntas.
    const avaliacao = classificarComandoPowerShell("Remove-Item x -Confirm:$false");
    expect(avaliacao).not.toBeNull();
    expect(avaliacao?.nivel).toBe("destrutivo");
  });

  it("o mais grave manda quando há vários padrões", () => {
    const avaliacao = classificarComandoPowerShell("Remove-Item x; Stop-Computer");
    expect(avaliacao?.nivel).toBe("critico");
  });

  it("comando vazio não classifica", () => {
    expect(classificarComandoPowerShell("")).toBeNull();
    expect(classificarComandoPowerShell("   ")).toBeNull();
  });
});

describe("encerrar processo", () => {
  it("processo comum é destrutivo; processo de sistema é crítico", () => {
    expect(classificarEncerrarProcesso("notepad").nivel).toBe("destrutivo");
    expect(classificarEncerrarProcesso("explorer").nivel).toBe("critico");
    expect(classificarEncerrarProcesso("EXPLORER.EXE").nivel).toBe("critico");
  });

  it("reconhece os processos essenciais do Windows", () => {
    expect(processoCritico("lsass")).toBe(true);
    expect(processoCritico("winlogon.exe")).toBe(true);
    expect(processoCritico("chrome")).toBe(false);
  });
});

describe("abrir programa", () => {
  it("interpretador com argumentos é a porta lateral que precisa fechar", () => {
    // abrir_programa("cmd", "/c rd /s /q ...") apagaria a pasta sem passar por
    // classificador nenhum.
    const avaliacao = classificarAbrirPrograma("cmd", "/c rd /s /q C:\\Users\\es553\\Documentos");
    expect(avaliacao).not.toBeNull();
    expect(avaliacao?.nivel).toBe("critico");
  });

  it("qualquer programa COM argumentos exige confirmação", () => {
    expect(classificarAbrirPrograma("notepad", "arquivo.txt")?.nivel).toBe("destrutivo");
  });

  it("programa comum sem argumentos passa direto", () => {
    expect(classificarAbrirPrograma("notepad")).toBeNull();
    expect(classificarAbrirPrograma("spotify", "")).toBeNull();
  });

  it("interpretador sem argumentos ainda é crítico", () => {
    expect(classificarAbrirPrograma("powershell")?.nivel).toBe("critico");
  });
});

describe("abrir caminho", () => {
  it.each([".bat", ".cmd", ".ps1", ".exe", ".msi", ".vbs", ".reg"])(
    "%s executa código e exige confirmação",
    (extensao) => {
      expect(classificarAbrirCaminho(`C:\\temp\\script${extensao}`)).not.toBeNull();
    }
  );

  it("documento comum abre sem perguntar", () => {
    expect(classificarAbrirCaminho("C:\\temp\\contrato.pdf")).toBeNull();
    expect(classificarAbrirCaminho("C:\\temp\\planilha.xlsx")).toBeNull();
    expect(classificarAbrirCaminho("C:\\temp")).toBeNull();
  });
});

describe("atalhos e extensões que parecem documento", () => {
  it("um .lnk executa o alvo gravado dentro dele", () => {
    // Na área de trabalho tem o mesmo aspecto de um PDF, e roda código.
    const avaliacao = classificarAbrirCaminho("C:\\Users\\es553\\Desktop\\notas.lnk");
    expect(avaliacao).not.toBeNull();
    expect(avaliacao?.chave).toBe("abrir_caminho:lnk");
  });

  it("outros disfarces conhecidos também são pegos", () => {
    for (const alvo of ["a.url", "b.pif", "c.cpl", "d.msc", "e.jar", "f.py"]) {
      expect(classificarAbrirCaminho(alvo), alvo).not.toBeNull();
    }
  });

  it("documento de verdade continua abrindo sem pergunta", () => {
    for (const alvo of ["relatorio.pdf", "planilha.xlsx", "foto.png", "notas.txt"]) {
      expect(classificarAbrirCaminho(alvo), alvo).toBeNull();
    }
  });
});
