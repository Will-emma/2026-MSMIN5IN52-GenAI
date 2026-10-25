# Rapport de flakiness

10 exécutions consécutives le 25/10/2026 01:41:06, sans retry, environnement Docker local (2 tenants + LLM simulé).

- Suite principale : **14 tests**, 14 stables, 0 instables ou en échec.
- Exécutions entièrement vertes (suite principale) : **10/10**
- Durée moyenne d'une exécution complète : 43.1 s

| Projet | Test | Succès | Échecs | Taux d'échec | Durée moy. | Verdict |
|---|---|---:|---:|---:|---:|---|
| owui | Connexion › sans session › un mauvais mot de passe affiche une erreur et reste sur /auth | 10 | 0 | 0 % | 0.9 s | stable |
| owui | Connexion › sans session › un utilisateur standard se connecte via le formulaire | 10 | 0 | 0 % | 1.9 s | stable |
| owui | Connexion › un utilisateur connecté arrive sur la page de chat | 10 | 0 | 0 % | 1.4 s | stable |
| owui | Chat › une question reçoit la réponse complète du modèle en streaming | 10 | 0 | 0 % | 3.5 s | stable |
| owui | Chat › une réponse longue au débit irrégulier est attendue jusqu'au bout | 10 | 0 | 0 % | 9.4 s | stable |
| owui | Chat › la conversation est enregistrée côté serveur | 10 | 0 | 0 % | 3.6 s | stable |
| owui | Chat › une panne du modèle est signalée à l'utilisateur | 10 | 0 | 0 % | 3.6 s | stable |
| owui | RAG › une question avec la base de connaissances renvoie le document source | 10 | 0 | 0 % | 0.4 s | stable |
| owui | RAG › la base de connaissances apparaît dans l'espace de travail | 10 | 0 | 0 % | 1.6 s | stable |
| owui | Isolation › un jeton du tenant A est refusé par le tenant B | 10 | 0 | 0 % | 0.0 s | stable |
| owui | Isolation › une base de connaissances du tenant A est invisible depuis le tenant B | 10 | 0 | 0 % | 0.1 s | stable |
| owui | Isolation › un utilisateur ne peut pas lire la conversation d'un autre | 10 | 0 | 0 % | 0.3 s | stable |
| owui | Rôles › dans le navigateur › un utilisateur standard est redirigé hors de /admin | 10 | 0 | 0 % | 2.4 s | stable |
| owui | Rôles › l'API d'administration refuse un utilisateur standard | 10 | 0 | 0 % | 0.2 s | stable |
| baseline | baseline naïve : lecture unique après un délai fixe | 0 | 10 | 100 % | 8.2 s | toujours en échec |

## Erreurs observées

- **baseline › baseline naïve : lecture unique après un délai fixe** : `Error: expect(received).toContain(expected) // indexOf`
