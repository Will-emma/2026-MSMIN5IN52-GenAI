/**
 * Se connecte UNE fois via l'interface et sauvegarde la session (cookies +
 * localStorage) : les tests suivants démarrent déjà connectés.
 * Évite aussi la limite de débit d'Open WebUI sur /api/v1/auths/signin.
 */
import { test as setup, expect } from '@playwright/test';
import { AUTH_FILE } from '../../playwright.config';
import { AUTH, CHAT } from '../helpers/selectors';

setup('connexion admin', async ({ page, request, baseURL }) => {
  const email = process.env.OWUI_EMAIL;
  const password = process.env.OWUI_PASSWORD;
  if (!email || !password) {
    throw new Error('OWUI_EMAIL / OWUI_PASSWORD manquants : copier .env.example vers .env et les renseigner.');
  }

  // Fenêtre « Quoi de neuf » : Open WebUI l'affiche tant que le réglage
  // utilisateur ui.version ne correspond pas à la version du serveur. Sur un
  // compte neuf (toujours le cas en CI), elle peut apparaître APRÈS le passage
  // de dismissModals() et intercepter les clics (échec CI du 27/10).
  // On marque donc la version comme vue par l'API, avant d'ouvrir l'interface :
  // c'est déterministe, au lieu de dépendre du moment où la fenêtre s'affiche.
  const signin = await request.post(`${baseURL}/api/v1/auths/signin`, { data: { email, password } });
  expect(signin.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await signin.json()).token}` };
  const { version } = await (await request.get(`${baseURL}/api/config`)).json();
  const settingsRes = await request.get(`${baseURL}/api/v1/users/user/settings`, { headers });
  const settings = (await settingsRes.json()) ?? {};
  const saved = await request.post(`${baseURL}/api/v1/users/user/settings/update`, {
    headers, data: { ...settings, ui: { ...settings.ui, version } },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto('/auth');
  await page.locator(AUTH.emailInput).fill(email);
  await page.locator(AUTH.passwordInput).fill(password);
  await page.locator(AUTH.submitButton).click();

  // Connecté = on a quitté /auth et la zone de saisie du chat est affichée.
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30_000 });
  await expect(page.locator(CHAT.input)).toBeVisible({ timeout: 30_000 });

  // Garde-fou : aucune fenêtre modale ne doit rester ouverte. Si c'est le cas,
  // on échoue ICI avec un message clair, plutôt qu'en timeout dans un autre test.
  await page.waitForTimeout(3_000);
  await expect(page.locator('[role="dialog"]'), 'une fenêtre modale bloque l\'interface après la connexion')
    .toHaveCount(0);

  await page.context().storageState({ path: AUTH_FILE });
});
