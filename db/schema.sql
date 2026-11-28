-- Schemat bazy aplikacji Szafarz 3.0 (wykonywany przy każdym wdrożeniu – tworzy tylko brakujące tabele).
-- W bazie są wyłącznie: osiedla, szafarze, harmonogram (terminy i przydziały z zamianami),
-- historia zmian harmonogramu, chorzy, zaplanowane wizyty oraz atrybuty (ustawienia aplikacji).

CREATE TABLE IF NOT EXISTS sz_osiedla (
  kod       text PRIMARY KEY,
  nazwa     text NOT NULL,
  kolejnosc integer NOT NULL
);

CREATE TABLE IF NOT EXISTS sz_szafarze (
  id        serial PRIMARY KEY,
  nazwisko  text NOT NULL UNIQUE,
  imie      text,
  aktywny   boolean NOT NULL DEFAULT true
);

-- Harmonogram: terminy posługi i przydział szafarzy do osiedli (planowy z harmonogramu i aktualny po zamianach).
CREATE TABLE IF NOT EXISTS sz_terminy (
  data  date PRIMARY KEY,
  nazwa text NOT NULL
);

CREATE TABLE IF NOT EXISTS sz_przydzialy (
  data                date    NOT NULL REFERENCES sz_terminy (data) ON DELETE CASCADE,
  osiedle             text    NOT NULL REFERENCES sz_osiedla (kod),
  szafarz_planowy_id  integer REFERENCES sz_szafarze (id),          -- pusty dla osiedla dodanego później
  szafarz_id          integer REFERENCES sz_szafarze (id),
  PRIMARY KEY (data, osiedle)
);

-- Wcześniejsze wersje wymagały szafarza planowego – osiedle dodane w Ustawieniach może go nie mieć.
ALTER TABLE sz_przydzialy ALTER COLUMN szafarz_planowy_id DROP NOT NULL;

-- Log zmian harmonogramu (zamiany szafarzy).
CREATE TABLE IF NOT EXISTS sz_zmiany_szafarzy (
  id           serial PRIMARY KEY,
  czas         timestamptz NOT NULL,
  data         date NOT NULL,
  osiedle      text NOT NULL,
  z_szafarza   text,
  na_szafarza  text,
  UNIQUE (czas, data, osiedle)
);

CREATE TABLE IF NOT EXISTS sz_chorzy (
  id             text PRIMARY KEY,
  imie           text NOT NULL,
  nazwisko       text NOT NULL,
  ulica          text NOT NULL,
  nr_domu        text NOT NULL,
  nr_mieszkania  text,
  pietro         text,
  uwagi          text,
  osiedle        text NOT NULL REFERENCES sz_osiedla (kod),
  utworzono      timestamptz NOT NULL DEFAULT now(),
  zmieniono      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sz_wizyty (
  data         date NOT NULL REFERENCES sz_terminy (data) ON DELETE CASCADE,
  chory_id     text NOT NULL REFERENCES sz_chorzy (id) ON DELETE CASCADE,
  osiedle      text NOT NULL REFERENCES sz_osiedla (kod),
  zaplanowano  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (data, chory_id)
);

-- Atrybuty aplikacji ustawiane w „Ustawieniach”.
CREATE TABLE IF NOT EXISTS sz_atrybuty (
  klucz      text PRIMARY KEY,
  wartosc    text NOT NULL,
  zmieniono  timestamptz NOT NULL DEFAULT now()
);
-- Czy nazwiska chorych są domyślnie ukryte (domyślnie: nie – nazwiska odkryte).
INSERT INTO sz_atrybuty (klucz, wartosc) VALUES ('nazwiska_ukryte', 'false') ON CONFLICT (klucz) DO NOTHING;
