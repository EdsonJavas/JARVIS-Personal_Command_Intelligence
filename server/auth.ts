import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { createHash, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../drizzle/schema";
import * as db from "./db";
import { ENV } from "./_core/env";

/**
 * Autenticação local: uma senha única definida no .env libera a sessão, e a
 * sessão em si é um JWT HS256 assinado com JWT_SECRET. Nenhum servidor externo
 * participa do fluxo — o Jarvis valida tudo dentro do próprio processo.
 */

/** openId fixo do dono da instalação. É a única identidade que existe. */
export const OWNER_OPEN_ID = "owner";

export type SessionPayload = {
  openId: string;
  name: string;
};

function getSessionSecret() {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET não configurado. Defina-o no arquivo .env.");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

/**
 * Compara a senha em tempo constante. O digest sha256 iguala os comprimentos
 * antes da comparação, então timingSafeEqual nunca recebe buffers de tamanhos
 * diferentes (que fariam a função lançar em vez de retornar false).
 */
export function passwordMatches(candidate: string): boolean {
  if (!ENV.appPassword) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(candidate), digest(ENV.appPassword));
}

export async function signSession(
  payload: SessionPayload,
  options: { expiresInMs?: number } = {}
): Promise<string> {
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((Date.now() + expiresInMs) / 1000);

  return new SignJWT({ openId: payload.openId, name: payload.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSessionSecret());
}

export async function verifySession(
  cookieValue: string | undefined | null
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;

  try {
    const { payload } = await jwtVerify(cookieValue, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    const { openId, name } = payload as Record<string, unknown>;

    if (typeof openId !== "string" || openId.length === 0) {
      console.warn("[Auth] Sessão sem openId");
      return null;
    }

    return { openId, name: typeof name === "string" ? name : "" };
  } catch (error) {
    console.warn("[Auth] Sessão inválida:", String(error));
    return null;
  }
}

/**
 * Lê a sessão da requisição. Retorna null quando não há sessão válida — quem
 * decide barrar é o protectedProcedure, não esta função.
 */
export async function authenticateRequest(req: Request): Promise<User | null> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const session = await verifySession(cookies[COOKIE_NAME]);
  if (!session) return null;

  const user = await db.getUserByOpenId(session.openId);
  return user ?? null;
}

/** Cria (ou atualiza) o usuário dono e devolve o token de sessão. */
export async function createOwnerSession(): Promise<string> {
  await db.upsertUser({
    openId: OWNER_OPEN_ID,
    name: ENV.ownerName,
    role: "admin",
    lastSignedIn: new Date(),
  });

  return signSession({ openId: OWNER_OPEN_ID, name: ENV.ownerName });
}
