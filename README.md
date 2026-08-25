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
cp .env.example .env      # preencha GEMINI_API_KEY
npm run dev
```

Sobe em `http://localhost:3000` e serve o frontend junto. O banco SQLite e as
tabelas são criados sozinhos no primeiro boot.

### Voz local, opcional mas recomendada

```bash
npm run voz:instalar      # baixa o Piper e três vozes brasileiras (~200 MB)
```

A voz principal são as neurais da Microsoft, alcançadas pelo servidor — sem
navegador específico e sem cota. O Piper fica como reserva offline, e a queda é
automática se a rede cair.

### Atalho global e bandeja

```bash
npm run atalho:instalar   # Ctrl+Alt+J chama de qualquer aplicativo
npm run atalho:remover    # desfaz
```

Fica ao lado do relógio, sobe com o Windows, e abre a janela sem barra de
endereço. Se o servidor não estiver de pé, ele sobe antes.

### Google — agenda e e-mail

```bash
npm run google:configurar  # guia passo a passo; confere o que já existe
```

---

## Como está montado

| Camada | Tecnologia |
|---|---|
| Interface | React 19 + Vite + wouter |
| API | tRPC sobre Express, e SSE para o fluxo de execução |
| Banco | SQLite local (libSQL + Drizzle), com migrações versionadas |
| Modelo | Endpoint compatível com OpenAI — padrão Gemini, trocável por `.env` |
| Voz | Neural da Microsoft pelo servidor · Piper local · Gemini TTS |
| Integrações | Ponte MCP (stdio) |
| Testes | Vitest — 372 passando |

### Decisões que valem saber

**O modelo troca sozinho quando a cota acaba.** O plano gratuito do Gemini dá 20
requisições por dia POR MODELO. A conta tem vários, então esgotar um não cala o
assistente: ele passa ao próximo. Vinte viram cerca de cem.

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
