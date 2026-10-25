/**
 * Fixtures partagées par les tests.
 *
 * - tenantA / tenantB : URL + jeton admin, obtenus UNE fois par worker
 *   (Open WebUI limite le débit de /api/v1/auths/signin).
 * - tempUser : utilisateur standard créé pour CE test (email unique) puis
 *   supprimé après, même si le test échoue. Aucun test ne dépend des données
 *   d'un autre : l'ordre d'exécution n'a pas d'importance.
 */
import { test as base, type APIRequestContext } from '@playwright/test';

export interface Tenant {
  url: string;
  token: string;
}

export interface TempUser {
  id: string;
  email: string;
  password: string;
  token: string;
}

export const MODEL = 'mock-echo';

/** Question longue (~25 mots) pour le scénario « streaming irrégulier » et sa baseline. */
export const LONG_QUESTION =
  'Peux-tu expliquer en quelques phrases comment fonctionne un test de bout en bout '
  + 'sur une application de chat qui répond en streaming avec un modèle de langage';

/** Identifiant unique pour nommer les données d'un test (users, KB, chats). */
export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function signin(request: APIRequestContext, url: string, email: string, password: string) {
  const res = await request.post(`${url}/api/v1/auths/signin`, { data: { email, password } });
  if (!res.ok()) throw new Error(`Connexion impossible sur ${url} (${res.status()}) : ${await res.text()}`);
  return (await res.json()).token as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function adminTenant(playwright: { request: { newContext: () => Promise<APIRequestContext> } }, url: string) {
  const ctx = await playwright.request.newContext();
  const token = await signin(ctx, url, process.env.OWUI_EMAIL!, process.env.OWUI_PASSWORD!);
  await ctx.dispose();
  return { url, token };
}

export const test = base.extend<{ tempUser: TempUser }, { tenantA: Tenant; tenantB: Tenant }>({
  tenantA: [async ({ playwright }, use) => {
    await use(await adminTenant(playwright, process.env.OWUI_URL || 'http://localhost:3000'));
  }, { scope: 'worker' }],

  tenantB: [async ({ playwright }, use) => {
    await use(await adminTenant(playwright, process.env.OWUI_TENANT2_URL || 'http://localhost:3001'));
  }, { scope: 'worker' }],

  tempUser: async ({ request, tenantA }, use) => {
    const email = `user-${uid()}@test.local`;
    const password = `Pw-${uid()}`;
    const res = await request.post(`${tenantA.url}/api/v1/auths/add`, {
      headers: auth(tenantA.token),
      data: { name: 'Utilisateur test', email, password, role: 'user' },
    });
    if (!res.ok()) throw new Error(`Création utilisateur impossible (${res.status()}) : ${await res.text()}`);
    const user = await res.json();

    await use({ id: user.id, email, password, token: user.token });

    // Nettoyage : supprime l'utilisateur (et ses données) quoi qu'il arrive.
    await request.delete(`${tenantA.url}/api/v1/users/${user.id}`, { headers: auth(tenantA.token) });
  },
});

export { expect } from '@playwright/test';
