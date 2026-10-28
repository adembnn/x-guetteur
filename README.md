# Guetteur X (@ademmbnn)

Repère les posts FR tech/IA de moins de 15 min qui démarrent, fait rédiger 2 réponses par Claude, et les envoie à Adem sur Telegram avec un bouton qui ouvre X pré-rempli. **Adem publie lui-même.** Rien n'est publié automatiquement.

- `worker/` : guetteur Cloudflare (chaque minute, 8 h-22 h Paris), lecture via FxTwitter, base D1, bot Telegram.
- `redaction/rediger.py` + `.github/workflows/rediger.yml` : rédacteur réveillé à la demande, Claude Code avec l'abonnement d'Adem.
- `contexte/` : copie du guide, du vécu et du contrôle, tenus dans le dossier Contenu (`./synchro.sh` puis commit).
- `installer.sh` : installation en une fois.

Telegram : `/stop` pause, `/go` reprise, `/etat` bilan. Coller le lien de sa réponse rattache la réponse à l'alerte.
