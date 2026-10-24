/**
 * Parcours RAG : un document est indexé dans une base de connaissances,
 * puis une question posée avec cette base doit s'appuyer sur ce document.
 * La préparation passe par l'API (rapide, fiable) ; la vérification
 * utilisateur passe par l'interface.
 */
import { test, expect, MODEL, uid, auth, type Tenant } from '../fixtures/owui';
import type { APIRequestContext } from '@playwright/test';

const FACT = 'La capitale secrète de Zorblandia est Quetzalville.';

async function createKnowledgeWithDoc(request: APIRequestContext, t: Tenant, name: string) {
  const kb = await (await request.post(`${t.url}/api/v1/knowledge/create`, {
    headers: auth(t.token), data: { name, description: 'Créée par les tests E2E' },
  })).json();

  const file = await (await request.post(`${t.url}/api/v1/files/?process=true`, {
    headers: auth(t.token),
    multipart: { file: { name: `${name}.txt`, mimeType: 'text/plain', buffer: Buffer.from(FACT) } },
  })).json();

  // L'ajout échoue tant que le fichier n'est pas indexé : on réessaie.
  await expect.poll(async () => (await request.post(`${t.url}/api/v1/knowledge/${kb.id}/file/add`, {
    headers: auth(t.token), data: { file_id: file.id },
  })).status(), { timeout: 20_000 }).toBe(200);

  return kb.id as string;
}

test.describe('RAG', () => {
  let kbId: string;
  let kbName: string;

  test.beforeEach(async ({ request, tenantA }) => {
    kbName = `kb-${uid()}`;
    kbId = await createKnowledgeWithDoc(request, tenantA, kbName);
  });

  test.afterEach(async ({ request, tenantA }) => {
    await request.delete(`${tenantA.url}/api/v1/knowledge/${kbId}/delete`, { headers: auth(tenantA.token) });
  });

  test('une question avec la base de connaissances renvoie le document source', async ({ request, tenantA }) => {
    const res = await request.post(`${tenantA.url}/api/chat/completions`, {
      headers: auth(tenantA.token),
      data: {
        model: MODEL, stream: false,
        messages: [{ role: 'user', content: 'Quelle est la capitale de Zorblandia ?' }],
        files: [{ type: 'collection', id: kbId }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // Citation traçable : la source renvoyée est bien notre document.
    expect(body.sources?.[0]?.document?.join(' ')).toContain('Quetzalville');
    expect(body.sources?.[0]?.metadata?.[0]?.name).toBe(`${kbName}.txt`);
    // Le contexte a bien été injecté dans le prompt (le mock le signale).
    expect(body.choices[0].message.content).toMatch(/fondée sur \d+ source/);
  });

  test('la base de connaissances apparaît dans l\'espace de travail', async ({ page }) => {
    await page.goto('/workspace/knowledge');
    await expect(page.getByText(kbName)).toBeVisible({ timeout: 15_000 });
  });
});
