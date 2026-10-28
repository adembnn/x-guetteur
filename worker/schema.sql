CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS cibles (handle TEXT PRIMARY KEY, priorite INTEGER DEFAULT 2, actif INTEGER DEFAULT 1, posts_jour REAL DEFAULT 0, prochain INTEGER DEFAULT 0);
-- Posts frais (moins de 20 min) vus par le guetteur : sert à régler le seuil « qui démarre ».
CREATE TABLE IF NOT EXISTS vus (id TEXT PRIMARY KEY, handle TEXT, created INTEGER, vu_a INTEGER, age_min REAL,
  views INTEGER, likes INTEGER, replies INTEGER, followers INTEGER, chaud INTEGER DEFAULT 0);
-- Une ligne par post chaud signalé à Adem. C'est la source de suivi/reponses.csv.
CREATE TABLE IF NOT EXISTS alertes (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT UNIQUE, handle TEXT, followers INTEGER,
  texte_post TEXT, post_created INTEGER, age_min REAL, views INTEGER, likes INTEGER, replies INTEGER,
  cree_a INTEGER, envoye_a INTEGER, brouillons TEXT, pourquoi TEXT, statut TEXT, tg_msg INTEGER,
  brouillon_choisi INTEGER, poste_a INTEGER, reply_id TEXT, reply_texte TEXT,
  vues_24h INTEGER, likes_24h INTEGER, reponses_24h INTEGER, auteur_a_repondu INTEGER, releve_a INTEGER, essais_releve INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS alertes_statut ON alertes(statut, cree_a);
