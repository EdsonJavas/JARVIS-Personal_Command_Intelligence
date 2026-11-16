# Configuração do provedor Gemini

O Jarvis usa o endpoint de compatibilidade com OpenAI do Gemini:

```text
https://generativelanguage.googleapis.com/v1beta/openai/
```

O modelo inicial utilizado pelo projeto é `gemini-3.6-flash`. Durante a validação da chave em 14 de agosto de 2026, o endpoint retornou `404 NOT_FOUND` para `gemini-2.5-flash`, informando que esse modelo não está disponível para novos usuários. Por isso, não trocar o padrão de volta para 2.5 sem validar novamente.

Os pedidos são enviados somente pelo servidor, com o segredo `GEMINI_API_KEY` no cabeçalho `Authorization: Bearer`. A chave nunca deve ser exposta ao código cliente ou registrada em arquivos do repositório.

O procedimento de chat exige sessão autenticada (senha local definida em `APP_PASSWORD`). Uma chamada sem cookie de sessão recebe `UNAUTHORIZED`, o que impede que terceiros gastem a cota da chave configurada no projeto.

## Reserva automática: Groq

Com `GROQ_API_KEY` no `.env`, o Groq entra como reserva. A ordem de tentativa é:

1. o provedor personalizado de `LLM_BASE_URL`, se houver;
2. o Gemini, com o rodízio de modelos de sempre;
3. o Groq, com a escada própria: `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`,
   `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` (troque com `GROQ_MODELS`).

A troca para a reserva acontece quando a escada inteira do provedor anterior
esgota no dia, quando ele pede pausa por minuto (com reserva não se espera),
quando fica instável (5xx), quando recusa a chave ou o modelo, ou quando não
responde. A resposta carrega quem respondeu, e a Ponte mostra o nome no canal
de texto — em âmbar quando é a reserva.

Três cuidados que a troca toma:

- A assinatura de raciocínio que o Gemini 3 grava nas chamadas de ferramenta
  (`extra_content`) é retirada antes de ir para outro provedor.
- A recusa de `reasoning_effort` vale por endereço: o Groq recusar não desliga
  o parâmetro para o Gemini.
- Voz ao vivo, voz sintetizada e leitura de tela usam só a chave do Gemini
  (`GEMINI_API_KEY`, ou `LLM_API_KEY` quando ela é do Google). A chave de outro
  provedor nunca é mandada ao Google.

O limite do Groq é escrito na frase do erro ("on requests per day (RPD)",
"Please try again in 2.5s"), e o classificador de recusas entende os dois
formatos.

## Troca de provedor compatível

O frontend do Jarvis não depende do provedor de IA. Para trocar o canal server-side, configure `LLM_API_KEY`, `LLM_BASE_URL` e `LLM_MODEL`; o gateway também mantém compatibilidade com o segredo `GEMINI_API_KEY` já configurado.

| Provedor | URL-base compatível | Modelo |
|---|---|---|
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-3.6-flash` |
| Groq | `https://api.groq.com/openai/v1` | Um modelo habilitado na conta Groq |
| OpenRouter | `https://openrouter.ai/api/v1` | Um modelo habilitado na conta OpenRouter |
| OpenAI | `https://api.openai.com/v1` | Um modelo habilitado na conta OpenAI |

O gateway envia requisições no contrato de `chat/completions`, portanto uma mudança de fornecedor não exige alteração no componente React do console.

## Validação da credencial

O comando `npm test` cobre a lógica do gateway sem consumir quota externa. Para testar a credencial e o provedor configurado de forma explícita, use `npm run test:gemini`. Essa verificação pode falhar temporariamente se o provedor estiver indisponível ou se a quota estiver esgotada; nesses casos, a aplicação apresenta a mensagem correspondente ao usuário.

## Limite de uso do provedor

Quando o provedor retorna HTTP `429`, o gateway classifica a ocorrência como `quota_exceeded` e o contrato tRPC a expõe como `TOO_MANY_REQUESTS`. O console não a registra como falha técnica inesperada: no chat, informa que a cota está temporariamente indisponível e apresenta uma ação para reenviar a última pergunta. Essa ação não presume que a cota já tenha sido renovada; ela apenas permite que o usuário tente de novo quando o provedor voltar a aceitar pedidos.

Se a indisponibilidade for recorrente, use uma das configurações compatíveis da tabela anterior, definindo `LLM_API_KEY`, `LLM_BASE_URL` e `LLM_MODEL` no ambiente do projeto. A troca mantém a interface e o contrato `chat/completions` existentes.

## Fontes oficiais

- [Compatibilidade OpenAI do Gemini](https://ai.google.dev/gemini-api/docs/openai)
- [Catálogo de modelos Gemini](https://ai.google.dev/gemini-api/docs/models)
- [Modelos do Groq com uso de ferramentas](https://console.groq.com/docs/tool-use)
