#!/bin/bash
# Remet les 2 jetons du guetteur. Rien ne s'affiche à l'écran et rien n'est écrit dans un fichier.
set -e
cd "$(dirname "$0")"
REPO="adembnn/x-guetteur"
lire() { # lit un jeton collé, même sur plusieurs lignes, jusqu'à une ligne vide
  local tout="" ligne
  while IFS= read -r -s ligne; do [ -z "$ligne" ] && break; tout="$tout$ligne"; done
  printf %s "$tout" | tr -d '[:space:]'
}

echo "== 1/2 Jeton Claude"
echo "   Une page s'ouvre pour te connecter, puis le jeton s'affiche. Copie TOUT le bloc (même s'il fait 3 lignes)."
claude setup-token || true
echo
echo "   ^^^ Le jeton est juste au-dessus (sk-ant-oat01-..., parfois sur 3 lignes). Copie tout le bloc."
echo "   Colle-le ici, puis appuie 2 fois sur Entrée (rien ne s'affiche, c'est normal) :"
CT=$(lire)
clear
case "$CT" in sk-ant-oat*) ;; *) echo "   Ça ne ressemble pas à un jeton Claude (il commence par sk-ant-oat). Relance le script."; exit 1;; esac
printf %s "$CT" | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$REPO"; echo "   jeton Claude enregistré (${#CT} caractères)"; unset CT

echo
echo "== 2/2 Jeton GitHub (pour que le guetteur réveille le rédacteur)"
echo "   Sur la page qui s'ouvre : Repository access → Only select repositories → $REPO"
echo "   Permissions → Repository permissions → Actions : Read and write. Puis Generate token et copie-le."
open "https://github.com/settings/personal-access-tokens/new" 2>/dev/null || true
echo "   Colle le jeton GitHub, puis appuie 2 fois sur Entrée :"
GT=$(lire)
printf %s "$GT" | (cd worker && npx wrangler secret put GH_TOKEN) >/dev/null && echo "   jeton GitHub enregistré"; unset GT
clear
echo "Fini. Dis « jetons ok » à Claude dans le chat."
