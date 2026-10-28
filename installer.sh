#!/bin/bash
# Installation du guetteur, à lancer une seule fois par Adem dans un terminal :  ./guetteur/installer.sh
# Les clés se tapent ici, en caché. Elles vont dans les coffres de Cloudflare et de GitHub, jamais dans un fichier ni dans le chat.
set -e
cd "$(dirname "$0")"
D="$(pwd)"
REPO="adembnn/x-guetteur"
W="npx --prefix $D/worker wrangler"
etape() { printf "\n\033[1m== %s\033[0m\n" "$1"; }
pause() { read -r -p "   (Entrée quand c'est fait) " _; }

etape "1/7 Connexion à Cloudflare (une page s'ouvre : crée ton compte gratuit ou connecte-toi, puis Autoriser)"
cd "$D/worker"
$W whoami 2>/dev/null | grep -q "logged in" || $W login

etape "2/7 Base de données gratuite (D1)"
if grep -q "A_REMPLIR" wrangler.toml; then
  ID=$($W d1 create guetteur-x 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -z "$ID" ] && ID=$($W d1 list --json | python3 -c "import json,sys;print([d['uuid'] for d in json.load(sys.stdin) if d['name']=='guetteur-x'][0])")
  sed -i '' "s/A_REMPLIR/$ID/" wrangler.toml
fi
$W d1 execute guetteur-x --remote --file schema.sql -y >/dev/null && echo "   tables créées"

etape "3/7 Mise en ligne du guetteur (si on te demande un sous-domaine workers.dev, tape par ex. ademmbnn)"
URL=$($W deploy 2>&1 | tee /dev/stderr | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
echo "   adresse : $URL"

etape "4/7 Clés internes (générées automatiquement)"
KEY=$(openssl rand -hex 24); SEC=$(openssl rand -hex 24)
printf %s "$KEY" | $W secret put WORKER_KEY >/dev/null
printf %s "$SEC" | $W secret put TELEGRAM_SECRET >/dev/null
umask 077; printf "WORKER_URL=%s\nWORKER_KEY=%s\n" "$URL" "$KEY" > "$D/.env"
echo "   ok (guetteur/.env écrit, il n'est pas envoyé sur GitHub)"

etape "5/7 Bot Telegram"
echo "   Dans Telegram : écris à @BotFather → /newbot → donne un nom (ex. Guetteur Adem) et un identifiant finissant par bot."
echo "   BotFather te donne un jeton qui ressemble à 123456:ABC-... Colle-le ci-dessous (rien ne s'affiche, c'est normal)."
read -r -s -p "   Jeton Telegram : " TG; echo
printf %s "$TG" | $W secret put TELEGRAM_TOKEN >/dev/null
curl -s "https://api.telegram.org/bot$TG/setWebhook" -d "url=$URL/telegram" -d "secret_token=$SEC" -d 'allowed_updates=["message","callback_query"]' | grep -q '"ok":true' && echo "   bot branché au guetteur"
BOT=$(curl -s "https://api.telegram.org/bot$TG/getMe" | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['username'])")
unset TG

etape "6/7 Jeton GitHub pour réveiller le rédacteur"
echo "   Ouvre : https://github.com/settings/personal-access-tokens/new"
echo "   Nom : guetteur · Expiration : 1 an · Repository access : Only select → $REPO"
echo "   Permissions → Repository → Actions : Read and write. Puis Generate token et copie-le."
open "https://github.com/settings/personal-access-tokens/new" 2>/dev/null || true
read -r -s -p "   Jeton GitHub : " GHT; echo
printf %s "$GHT" | $W secret put GH_TOKEN >/dev/null; unset GHT

etape "7/7 Ton abonnement Claude pour le rédacteur"
echo "   Une page s'ouvre pour te connecter à Claude, puis un jeton s'affiche ici (il commence par sk-ant-oat). Copie-le."
claude setup-token || true
read -r -s -p "   Colle le jeton Claude : " CT; echo
printf %s "$CT" | gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$REPO"; unset CT
printf %s "$URL" | gh secret set WORKER_URL -R "$REPO"
printf %s "$KEY" | gh secret set WORKER_KEY -R "$REPO"

cd "$D/.."
[ -f suivi/cibles.json ] && python3 outils/sync_reponses.py --cibles

etape "Fini"
echo "   Dernière chose : ouvre Telegram, va sur @$BOT et envoie /start."
echo "   Ensuite dis « installé » à Claude dans le chat : il lance un essai de bout en bout."
