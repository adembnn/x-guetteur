#!/bin/sh
# Copie dans le dépôt du guetteur les fichiers de référence tenus dans Contenu (une seule source de vérité).
set -e
C="$(cd "$(dirname "$0")/.." && pwd)"
D="$(cd "$(dirname "$0")" && pwd)/contexte"
mkdir -p "$D/vecu"
cp "$C/guide-redaction.md" "$D/"
cp "$C/reference/adem-posts.md" "$D/"
cp "$C/outils/controle_reponses.py" "$D/"
rm -f "$D/vecu/"*.md; cp "$C/vecu/"*.md "$D/vecu/"
[ -f "$C/suivi/cibles.json" ] && cp "$C/suivi/cibles.json" "$D/"
echo "contexte synchronisé"
