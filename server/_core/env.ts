export const ENV = {
  /** Segredo usado para assinar o cookie de sessão (HS256). */
  cookieSecret: process.env.JWT_SECRET ?? "",
  /** Caminho do arquivo SQLite. */
  databaseUrl: process.env.DATABASE_URL ?? "./data/jarvis.db",
  /** Senha única de acesso ao Jarvis, definida no .env. */
  appPassword: process.env.APP_PASSWORD ?? "",
  /** Nome exibido para o dono da instalação. */
  ownerName: process.env.OWNER_NAME ?? "Operador",
  isProduction: process.env.NODE_ENV === "production",
};
