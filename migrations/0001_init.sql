CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE colors (
  id INTEGER PRIMARY KEY,
  hex TEXT NOT NULL,
  name TEXT NOT NULL,
  discoverer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE color_questions (
  color_id INTEGER NOT NULL REFERENCES colors(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  PRIMARY KEY (color_id, question_id)
);

CREATE TABLE guesses (
  color_id INTEGER NOT NULL REFERENCES colors(id),
  player_id TEXT NOT NULL,
  hex TEXT NOT NULL,
  delta_e REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (color_id, player_id)
);

CREATE TABLE hints (
  id INTEGER PRIMARY KEY,
  color_id INTEGER NOT NULL REFERENCES colors(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  player_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (color_id, question_id, player_id)
);
CREATE INDEX hints_color ON hints(color_id);

CREATE TABLE likes (
  hint_id INTEGER NOT NULL REFERENCES hints(id),
  player_id TEXT NOT NULL,
  PRIMARY KEY (hint_id, player_id)
);

INSERT INTO questions (text) VALUES
  ('Jaké jídlo nebo pití má tuhle barvu?'),
  ('Jaké místo ti tahle barva připomíná?'),
  ('Jakou náladu tahle barva vyvolává?'),
  ('Jaká věc z dětství měla tuhle barvu?'),
  ('Jak by tahle barva zněla?'),
  ('Jaké počasí nebo roční období to je?'),
  ('Jaké zvíře nebo rostlina má tuhle barvu?'),
  ('Jak by tahle barva voněla?'),
  ('Jaký kus oblečení má tuhle barvu?'),
  ('Jaká denní doba to je?'),
  ('Z jakého materiálu by tahle barva byla?'),
  ('Jaká postava z filmu nebo knihy by ji nosila?'),
  ('Kde doma bys tuhle barvu našel/našla?'),
  ('Jak by tahle barva chutnala?'),
  ('Jaké slovo tě při téhle barvě napadne jako první?');
