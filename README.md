# JARVIS

Assistente pessoal que roda na sua máquina, age nela com autorização, fala com
você e procura você quando algo vence.

Não é um chat com acesso a ferramentas. É um assistente com **noção de tempo**
— marca lembrete, mantém rotina, vigia a máquina e avisa sozinho — que **aprende
entre conversas**, **vê a tela**, **lê e escreve arquivos**, e **narra o que está
fazendo enquanto faz**.

Roda inteiro no seu computador. A única coisa que sai daqui é a chamada ao
provedor de IA que você escolher.

---

## O que ele faz

**Age na máquina.** 32 ferramentas nativas: medir hardware, listar e encerrar
processos, buscar e ler arquivos, escrever e editar documentos, abrir programas,
área de transferência, capturar e interpretar a tela, buscar na web, e PowerShell
livre para o que não estiver previsto.

**Pede permissão antes do que não tem volta.** Apagar arquivo, encerrar processo
de sistema, enviar e-mail, sobrescrever documento: tudo passa por uma trava que
BLOQUEIA a execução até você confirmar. Confirmação de ação destrutiva nunca é
aceita por voz — só por clique. Silêncio, expiração e cancelamento contam como
recusa.

**Fala primeiro, depois executa.** Cada ferramenta anuncia o que vai fazer antes
de fazer, com frases sintetizadas de véspera e guardadas em cache — o anúncio sai
instantâneo e a voz vem na frente do trabalho, não depois.

**Aprende, e você audita.** O que ele guarda sobre você sobrevive a reinício e
volta nas conversas seguintes. Um filtro de segredos bloqueia chave de API, JWT,
senha em URI, CPF e cartão antes de qualquer gravação. Tudo é visível e apagável
no painel, e esquecer é reversível.

**Procura você.** Lembretes, rotinas e vigias de métrica. Com a tela aberta ele
fala; com o navegador fechado, dispara notificação nativa do Windows.

**Conecta o que existir.** Ponte MCP: qualquer servidor do protocolo vira
ferramenta dentro do mesmo laço — com narração, trava de risco e orçamento. Vem
configurado com Google Agenda e Gmail.

---

## Como rodar

```bash
npm install
node node_modules/electron/install.js   # só se o npm bloquear scripts de instalação
cp .env.example .env      # preencha APP_PASSWORD, JWT_SECRET e GEMINI_API_KEY
npm run dev
```

Sobe em `http://localhost:3000` e serve o frontend junto. O banco SQLite e as
tabelas são criados sozinhos no primeiro boot.

### A ilha

```bash
npm run ilha              # a ilha no alto da tela, agora
npm run atalho:instalar   # e sempre: sobe junto com o Windows
npm run atalho:remover    # desfaz
```

O Jarvis mora numa pílula preta no alto da **área de trabalho**, como a ilha do
iPhone. Ela só existe com a mesa à vista: qualquer janela aberta, em qualquer
monitor, a esconde; minimizou tudo, ela volta. Cresce sozinha para um lembrete
que chegou e alarga enquanto ele fala.

Um clique abre o **mini sistema**: o dia (resumo, agenda, e-mails que pedem
resposta, o tempo), os lembretes e rotinas — marcados ali mesmo, sem gastar cota
de IA — e a memória, com o que ele sabe sobre você para apagar ou desfazer. Esc,
ou um clique fora, fecha. Conversar é na Ponte, a um botão do mini sistema.

**Ctrl+Alt+J**: na área de trabalho, abre e fecha o mini sistema; com janelas
abertas, traz a Ponte para a frente (ou a abre, se não estiver aberta).

O ícone ao lado do relógio abre a Ponte e o painel, esconde a ilha ou sai, e a
dica dele diz por que a ilha não está à vista. Se o servidor não estiver de pé,
a ilha o sobe antes. Quem descobre se há janela aberta é
`desktop/vigia-da-mesa.ps1` (`-Listar` mostra quais janelas estão contando);
`JARVIS_IGNORAR_JANELAS=1` deixa a ilha sempre à vista, para desenvolver.

### Voz local, opcional mas recomendada

```bash
npm run voz:instalar      # baixa o Piper e três vozes brasileiras (~200 MB)
```

A voz principal são as neurais da Microsoft, alcançadas pelo servidor — sem
navegador específico e sem cota. O Piper fica como reserva offline, e a queda é
automática se a rede cair.

### Groq — a reserva quando o Gemini acaba

Ponha `GROQ_API_KEY` no `.env` (chave gratuita em console.groq.com/keys). Quando
a escada inteira do Gemini esgota no dia, ou ele cai, o Groq responde sozinho e a
Ponte mostra "Groq" no canal de texto. Voz ao vivo, voz sintetizada e leitura de
tela continuam só no Gemini — a chave do Groq nunca vai para o Google.

### Google — agenda e e-mail

```bash
npm run google:configurar  # guia passo a passo; confere o que já existe
```

---

## Como está montado

| Camada | Tecnologia |
|---|---|
| Interface | React 19 + Vite + wouter · a ilha em Electron (`desktop/`) |
| API | tRPC sobre Express, e SSE para o fluxo de execução |
| Banco | SQLite local (libSQL + Drizzle), com migrações versionadas |
| Modelo | Endpoint compatível com OpenAI — Gemini, com o Groq de reserva |
| Voz | Neural da Microsoft pelo servidor · Piper local · Gemini TTS |
| Integrações | Ponte MCP (stdio) |
| Testes | Vitest — 571 passando |

### Decisões que valem saber

**O modelo troca sozinho quando a cota acaba.** O plano gratuito do Gemini dá 20
requisições por dia POR MODELO. A conta tem vários, então esgotar um não cala o
assistente: ele passa ao próximo. Vinte viram cerca de cem. Quando a escada
inteira acaba, a reserva do Groq assume, com a escada própria dela.

**A ilha é Electron; a Ponte continua no navegador.** A ilha precisa de janela
transparente, sem borda e que deixe o clique passar — nada disso existe numa
janela de navegador. Ela NÃO fica sempre por cima: é da área de trabalho, e
qualquer programa que abre já fica na frente dela antes mesmo de ela sumir. A Ponte abre no Chrome ou Edge em modo
app porque lá o ditado e a escuta pela palavra "Jarvis" funcionam; no Electron,
não. Com as duas abertas, só a ilha fala os lembretes.

**O catálogo de ferramentas é filtrado por assunto.** Mandar as 64 a cada rodada
custava 60 KB de esquema e levava uma saudação a 131 segundos. As nativas ficam
sempre; agenda e e-mail entram quando a conversa pede.

**Nada de estado de teste toca dado real.** Banco, rodízio de modelos e orçamento
de voz respeitam `JARVIS_DATA_DIR`, que o vitest aponta para uma pasta própria.

---

## Segurança

Isto executa comandos arbitrários na máquina onde roda. É uma escolha explícita
de quem instala, e o projeto assume um único dono, em rede local.

O que o projeto garante não é restrição de escopo — é que nenhuma execução trave
o servidor, estoure memória, sobreviva ao cancelamento ou aconteça sem deixar
rastro. Ação destrutiva pede confirmação por clique. Processos filhos são mortos
em árvore no cancelamento. Segredo lido de arquivo é redigido antes de chegar ao
modelo.

`.env`, o banco, o cache de voz e as credenciais do Google ficam fora do
versionamento.

---

## Licença

Uso pessoal. Sem garantia.
