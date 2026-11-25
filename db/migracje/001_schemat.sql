-- Schemat bazy aplikacji Szafarz 3.0. Wszystkie tabele mają prefiks sz_.

-- Numer wersji danych – chroni przed nadpisaniem zmian, gdy dwie osoby zapisują jednocześnie.
CREATE TABLE sz_wersja (
  id      integer PRIMARY KEY CHECK (id = 1),
  wersja  integer NOT NULL
);
INSERT INTO sz_wersja (id, wersja) VALUES (1, 1);

-- Ustawienia i treści wspólnoty (kancelaria, opiekun, spotkania, opis).
CREATE TABLE sz_ustawienia (
  klucz   text PRIMARY KEY,
  wartosc text NOT NULL
);

CREATE TABLE sz_osiedla (
  kod       text PRIMARY KEY,
  nazwa     text NOT NULL,
  kolejnosc integer NOT NULL
);

CREATE TABLE sz_szafarze (
  id        serial PRIMARY KEY,
  nazwisko  text NOT NULL UNIQUE,
  imie      text,
  aktywny   boolean NOT NULL DEFAULT true
);

-- Harmonogram: terminy posługi i przydział szafarzy do osiedli.
CREATE TABLE sz_terminy (
  data  date PRIMARY KEY,
  nazwa text NOT NULL
);

CREATE TABLE sz_przydzialy (
  data                date    NOT NULL REFERENCES sz_terminy (data) ON DELETE CASCADE,
  osiedle             text    NOT NULL REFERENCES sz_osiedla (kod),
  szafarz_planowy_id  integer NOT NULL REFERENCES sz_szafarze (id),
  szafarz_id          integer REFERENCES sz_szafarze (id),
  PRIMARY KEY (data, osiedle)
);

CREATE TABLE sz_uwagi_harmonogramu (
  id        serial PRIMARY KEY,
  kolejnosc integer NOT NULL DEFAULT 0,
  tytul     text,
  tresc     text NOT NULL
);

-- Zamiany szafarzy wprowadzone w aplikacji.
CREATE TABLE sz_zmiany_szafarzy (
  id           serial PRIMARY KEY,
  czas         timestamptz NOT NULL,
  data         date NOT NULL,
  osiedle      text NOT NULL,
  z_szafarza   text,
  na_szafarza  text,
  UNIQUE (czas, data, osiedle)
);

-- Chorzy i zaplanowane wizyty.
CREATE TABLE sz_chorzy (
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

CREATE TABLE sz_wizyty (
  data         date NOT NULL REFERENCES sz_terminy (data) ON DELETE CASCADE,
  chory_id     text NOT NULL REFERENCES sz_chorzy (id) ON DELETE CASCADE,
  osiedle      text NOT NULL REFERENCES sz_osiedla (kod),
  zaplanowano  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (data, chory_id)
);

-- Dziennik wszystkich akcji zapisujących dane.
CREATE TABLE sz_dziennik (
  id          bigserial PRIMARY KEY,
  czas        timestamptz NOT NULL DEFAULT now(),
  akcja       text NOT NULL,
  szczegoly   jsonb,
  adres_ip    text
);

-- „Słowo na dziś”, kalendarz świąt stałych i teksty obrzędów.
CREATE TABLE sz_slowo_na_dzis (
  data          date PRIMARY KEY,
  cytat         text,
  sigla_cytatu  text,
  czytania      jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE sz_swieta_stale (
  miesiac  integer NOT NULL,
  dzien    integer NOT NULL,
  nazwa    text NOT NULL,
  kolor    text NOT NULL CHECK (kolor IN ('bialy', 'czerwony', 'fioletowy', 'zielony')),
  ranga    text NOT NULL,
  PRIMARY KEY (miesiac, dzien)
);

CREATE TABLE sz_obrzedy (
  id         text PRIMARY KEY,
  kolejnosc  integer NOT NULL,
  zakladka   text NOT NULL,
  skrot      text NOT NULL,
  tytul      text NOT NULL,
  wstep      text NOT NULL DEFAULT ''
);

CREATE TABLE sz_obrzedy_kroki (
  obrzed_id  text NOT NULL REFERENCES sz_obrzedy (id) ON DELETE CASCADE,
  nr         integer NOT NULL,
  sekcja     text NOT NULL,
  tytul      text NOT NULL,
  bloki      jsonb NOT NULL,
  PRIMARY KEY (obrzed_id, nr)
);
