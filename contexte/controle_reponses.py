#!/usr/bin/env python3
"""Contrôle des réponses proposées par le guetteur (une réponse = un message sous le post de quelqu'un).

Usage :
  controle_reponses.py brouillon.json            -> affiche OK/KO par réponse, code 1 si une réponse est KO
  controle_reponses.py --test                    -> lance les cas d'essai intégrés

Format de brouillon.json :
  {"post": {"text": "...", "author": "leploutos"},
   "replies": ["réponse 1", "réponse 2"],
   "recent": ["réponses publiées ces dernières heures", "..."]}
"""
import json, re, sys, unicodedata
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI))

# Liste noire commune aux posts (copiée de controle.py pour ne pas l'exécuter à l'import).
NOIRE_POSTS = [r"ce n'est pas .{1,40}c'est", r"non seulement", r"\bcrucial", r"\bessentiel", r"incontournable", r"révolution",
    r"\bvéritable", r"dans un monde où", r"à l'ère de", r"voici pourquoi", r"personne ne parle", r"\bimaginez",
    r"soyons honnêtes", r"\ben outre\b", r"par ailleurs", r"de plus,", r"permet(tre)? de", r"jouer un rôle",
    r"mettre en lumière", r"des études montrent", r"reste à savoir", r"vrai gain de", r"\bune skill", r"\bnos workflows",
    r"il convient", r"force est de", r"binôme", r"coéquipier", r"\bbuzz", r"une étude", r"des répondants", r"c.est qui qui",
    r"ceux qui y vont"]

# Formules interchangeables typiques des réponses d'IA ou de spam.
NOIRE_REPONSES = [r"super (post|point|thread|partage)", r"totalement d'accord", r"tout à fait d'accord", r"(très )?bonne (question|remarque|analyse)",
    r"merci pour (le|ce) partage", r"\bexcellent", r"\bpertinent", r"\bbravo\b", r"\bincroyable\b", r"\bfascinant", r"\bintéressant(e)? (post|point|analyse)",
    r"je suis d'accord", r"\bgreat\b", r"\bawesome\b", r"\bpassionnant", r"\bimpressionnant", r"(tu|vous) as (totalement|complètement) raison",
    r"^(effectivement|absolument|exactement)\b", r"ça (résonne|me parle) (tellement|beaucoup)", r"\bclairement\b.*\bclairement\b",
    r"en tant qu", r"c.est pour ça qu", r"le pire c.est que", r"tu crois qu.on pourra", r"d.après les règles", r"c.est pile ce qu", r"\ben soi\b", r"c.est pas le souci", r"\bun jour laisser\b", r"\bn'hésite(z)? pas\b", r"\b(en|par|viens en|écris-moi en) (dm|mp)\b", r"lien en bio", r"abonne", r"\bfollow\b"]

INTERDITS = [r"\bmate\b", r"major ?pr[ée]pa", r"square management", r"\bsquare\b"]

EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿⭐✅❌]")
LIEN = re.compile(r"https?://|www\.|\b\w+\.(com|fr|io|ai|app|dev)\b", re.I)
DEUX_BRANCHES = re.compile(r"\bou (un|une|le|la|les|des|du|vous|tu|plutôt|alors|bien|juste|sur|en|par|avec|pas)\b[^?.!\n]*\?", re.I)

MOTS_VIDES = set("""alors aussi autre avant avec avoir bien c'est cela cette comme dans depuis donc elle elles encore entre être fait faire
font genre juste leur leurs mais même moins notre nous parce pendant peut plus pour pourquoi quand quel quelle quels sans selon sont sous
tout tous toute toutes très trop vers votre vous était avait cest quoi chez faut veux veut vraiment toujours jamais rien personne""".split())

# Faits de vécu qu'Adem peut prouver (vecu/). Toute affirmation à la 1re personne avec un chiffre hors de cette liste est signalée.
CHIFFRES_VECU = {"9", "9h", "10", "19", "19h", "15", "15h", "20", "30", "2", "12", "2000", "1", "4"}


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c)).replace("’", "'")


def mots_forts(s):
    return {m for m in re.findall(r"[a-z0-9]{4,}", norm(s)) if m not in MOTS_VIDES}


def ouverture(s):
    return " ".join(re.findall(r"\w+", norm(s))[:3])


def controle(rep, post_text, recent, autres):
    pb, avert = [], []
    r = rep.strip()
    n = len(r)
    if n < 25: pb.append(f"trop court ({n} car.)")
    if n > 200: pb.append(f"trop long ({n} car., une réaction de pote tient en 40-120)")
    elif n > 140: avert.append(f"un peu long ({n} car.)")
    if "—" in r or " – " in r: pb.append("tiret cadratin")
    if LIEN.search(r): pb.append("lien")
    if "#" in r: pb.append("hashtag")
    if EMOJI.search(r): pb.append("emoji")
    if r.startswith("@"): pb.append("commence par @ (X l'ajoute tout seul)")
    for p in NOIRE_POSTS + NOIRE_REPONSES:
        if re.search(p, r, re.I | re.M): pb.append(f"liste noire : {p}")
    for p in INTERDITS:
        if re.search(p, r, re.I): pb.append("sujet interdit (Mate / Major Prépa / Square)")
    if DEUX_BRANCHES.search(r): pb.append("question à deux branches")
    if r.count("?") > 1: pb.append("plus d'une question")
    # Un détail repris du post : au moins un mot fort ou un chiffre en commun.
    communs = mots_forts(r) & mots_forts(post_text)
    chiffres_post = set(re.findall(r"\d+", post_text))
    if not communs and not (set(re.findall(r"\d+", r)) & chiffres_post):
        avert.append("ne reprend aucun mot du post (OK si c'est une réaction)")
    # Vécu : chiffre à la 1re personne qui n'est pas dans vecu/.
    if re.search(r"\b(j'ai|on a|j'avais|on avait|moi|perso|chez moi|je)\b", norm(r)):
        for c in re.findall(r"\d+", r):
            if c not in CHIFFRES_VECU and c not in chiffres_post:
                avert.append(f"chiffre de vécu « {c} » à vérifier dans vecu/")
    # Variété : même ouverture qu'une réponse récente ou que l'autre brouillon.
    o = ouverture(r)
    for x in recent:
        if ouverture(x) == o: pb.append(f"même ouverture qu'une réponse récente (« {o} »)")
    for x in autres:
        if ouverture(x) == o: avert.append("même ouverture que l'autre brouillon")
    return pb, avert


def main(path):
    d = json.load(open(path, encoding="utf-8"))
    post = d.get("post", {}).get("text", "")
    reps = d.get("replies", [])
    recent = d.get("recent", [])
    ko = 0
    out = []
    for i, r in enumerate(reps, 1):
        pb, av = controle(r, post, recent, [x for j, x in enumerate(reps, 1) if j != i])
        ko += bool(pb)
        out.append({"n": i, "ok": not pb, "problemes": pb, "avertissements": av})
        print(("OK  " if not pb else "KO  ") + f"{i}. {r[:70]}" + ("" if not pb else " → " + " ; ".join(pb)) + ("" if not av else "  (avert. : " + " ; ".join(av) + ")"))
    print(f"== {ko} réponse(s) KO sur {len(reps)}")
    if "--json" in sys.argv:
        print("JSON " + json.dumps(out, ensure_ascii=False))
    return 1 if ko else 0


def tests():
    post = "J'ai remplacé mon process de relance client par un agent n8n, 3 semaines de test, 40 % de réponses en plus."
    cas = [
        ("Super post ! Totalement d'accord avec toi 🔥", False),
        ("tes 40 % de réponses en plus, c'est sur des relances froides ou des clients qui t'avaient déjà parlé ? ça change tout le calcul", False),  # deux branches
        ("40 % en 3 semaines c'est énorme. tu gères comment les relances qui partent au mauvais moment, genre un client qui vient de payer ?", True),
        ("Hello, check mon site www.monapp.io pour ça", False),
        ("j'ai monté un truc proche en hackathon, le plus dur c'était pas l'agent n8n mais de savoir quand il doit se taire. tu lui mets une règle d'arrêt ?", True),
        ("C'est fou ce que l'IA permet de faire aujourd'hui, vraiment.", False),
    ]
    ok = 0
    for txt, attendu in cas:
        pb, _ = controle(txt, post, [], [])
        bon = (not pb) == attendu
        ok += bon
        print(("PASSE " if bon else "ÉCHEC ") + txt[:60] + ("" if bon else f" → {pb}"))
    print(f"== {ok}/{len(cas)} cas d'essai passés")
    return 0 if ok == len(cas) else 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        sys.exit(tests())
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1]))
