import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

// A validação real do provedor (npm run test:gemini) lê a credencial do .env, do
// mesmo jeito que o servidor faz. Os testes unitários não dependem disto.
dotenv.config({ path: path.resolve(templateRoot, ".env") });

/*
 * Banco de TESTE, sempre — decidido aqui e não em cada arquivo de teste.
 *
 * Um `import` estático do módulo sob teste carrega a configuração antes de
 * qualquer `beforeAll` conseguir trocar a variável, e a suíte passa a gravar no
 * banco de verdade do dono. Foi o que aconteceu: doze linhas de lixo no
 * jarvis.db real, incluindo rotinas ativas que disparariam de manhã.
 *
 * Definido no arranque do vitest, o vazamento deixa de ser possível, e não
 * depende de cada teste lembrar de fazer a coisa certa.
 */
process.env.DATABASE_URL = path.resolve(templateRoot, "data", "teste", "vitest.db");

/*
 * Todo estado em disco vai para a mesma pasta de teste.
 *
 * O banco nao era o unico: o rodizio de modelos e o orcamento de voz tambem
 * gravam, e uma execucao ao vivo deixava marcas que o teste seguinte lia —
 * falhando por um motivo que nada tinha a ver com o que ele verifica.
 */
process.env.JARVIS_DATA_DIR = path.join("data", "teste");

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/src/lib/**/*.test.ts",
      /*
       * `shared/` também. Quando `fala.ts` mudou de `server/jarvis/` para cá,
       * o teste veio junto — e parou de rodar em silêncio, porque não estava
       * no padrão. Teste que não roda é pior que teste que não existe.
       */
      "shared/**/*.test.ts"],
    // Na primeira execução após uma instalação limpa o cache de transformação
    // está vazio, e o beforeAll que importa os módulos dinamicamente pode
    // estourar o limite padrão de 10s sem que haja nada errado com o teste.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
