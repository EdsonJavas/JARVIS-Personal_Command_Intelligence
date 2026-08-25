# Configuração do provedor Gemini

O Jarvis usa o endpoint de compatibilidade com OpenAI do Gemini:

```text
https://generativelanguage.googleapis.com/v1beta/openai/
```

O modelo inicial utilizado pelo projeto é `gemini-3.6-flash`. Durante a validação da chave em 14 de agosto de 2026, o endpoint retornou `404 NOT_FOUND` para `gemini-2.5-flash`, informando que esse modelo não está disponível para novos usuários. Por isso, não trocar o padrão de volta para 2.5 sem validar novamente.

Os pedidos são enviados somente pelo servidor, com o segredo `GEMINI_API_KEY` no cabeçalho `Authorization: Bearer`. A chave nunca deve ser exposta ao código cliente ou registrada em arquivos do repositório.

O procedimento de chat exige sessão autenticada (senha local definida em `APP_PASSWORD`). Uma chamada sem cookie de sessão recebe `UNAUTHORIZED`, o que impede que terceiros gastem a cota da chave configurada no projeto.

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
