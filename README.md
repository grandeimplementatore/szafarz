# Szafarz 3.0

Aplikacja Wspólnoty Szafarzy Nadzwyczajnych Komunii Świętej – Parafia bł. Karoliny Kózkówny w Tychach.

Strony: Strona główna, Harmonogram, Planner wizyt, Nasi Chorzy, Obrzęd Komunii Świętej (także krok po kroku), Nasza Wspólnota, Konta. Każda w wersji na komputer i telefon – aplikacja sama wybiera wersję po szerokości ekranu.

## Wdrożenie na Heroku

Jedyne, czego aplikacja potrzebuje, to **baza Heroku Postgres podłączona do aplikacji** (zmienna `DATABASE_URL` ustawia się sama).

```bash
heroku addons:attach aftech::DATABASE -a szafarz --as DATABASE   # albo: heroku addons:create heroku-postgresql:essential-0 -a szafarz
git push heroku main          # albo w panelu: Deploy → GitHub → Deploy Branch
```

Przy pierwszym starcie aplikacja sama zakłada w bazie wszystkie tabele i generuje klucz sesji.

**Pierwsze wejście:** otwórz adres aplikacji – pojawi się ekran „Pierwsze uruchomienie”. Załóż konto administratora (zrób to od razu po wdrożeniu – ekran jest dostępny tylko dopóki nie ma żadnego konta).

**Kolejni szafarze:** administrator wchodzi w **Konta** (link na górnym pasku, na telefonie w menu ☰) i dodaje szafarza: imię i nazwisko, login, hasło startowe. Tam też ustawia nowe hasło, gdy ktoś zapomni, albo usuwa konto. Każdy może zmienić swoje hasło na tej samej stronie.

## Gdzie są dane

Wszystko w bazie PostgreSQL – tabele tworzą się same, innych tabel w bazie aplikacja nie rusza:

| Tabela | Co zawiera |
|---|---|
| `szafarz_store` | wspólne dane: chorzy, plan wizyt, zmiany szafarzy, dziennik zmian (jeden dokument JSON z wersją) |
| `szafarz_audit` | kto i kiedy zapisał zmiany |
| `szafarz_users` | konta szafarzy (hasła tylko jako skróty scrypt) |
| `szafarz_config` | klucz podpisujący sesje (losowy, generowany automatycznie) |

Gdy dwie osoby zmienią dane w tym samym czasie, zapisze się zmiana pierwszej, a druga zobaczy komunikat i odświeżoną stronę.

Kopie zapasowe bazy: `heroku pg:backups:schedule DATABASE_URL --at "03:00 Europe/Warsaw" -a NAZWA-APLIKACJI-Z-BAZĄ`.

## Ustawienia opcjonalne (Config Vars)

| Zmienna | Opis |
|---|---|
| `REVEAL_CODE` | kod do odkrywania nazwisk chorych na ekranie (domyślnie 1234) |
| `SESSION_DAYS` | ile dni trwa zalogowanie (domyślnie 14) |
| `SEED_DEMO` | `1` = 10 fikcyjnych chorych przy tworzeniu pustej bazy (tylko testy) |

Zmienne `SESSION_SECRET` i `USERS` nie są już używane – można je usunąć z Config Vars.

## Jak to działa

- `server.js` – serwer Node.js: logowanie, konta, strony, API danych.
- `design/*.dc.html` – źródło wyglądu (pliki z projektu Claude Design); `scripts/build.js` buduje z nich strony do `public/` (Heroku robi to samo przy wdrożeniu).
- `static/runtime.js` – silnik stron w przeglądarce: rysuje widoki i zapisuje zmiany na serwerze.
- `lib/store.js` – baza danych, `lib/auth.js` – hasła i sesje.

Uruchomienie lokalne bez bazy (dane w pamięci, znikają po zatrzymaniu): `DATABASE_URL=memory SEED_DEMO=1 npm run dev` → http://localhost:3000

## Bezpieczeństwo i RODO

- Wszystkie strony i dane są dostępne dopiero po zalogowaniu. Ciasteczko sesji: `HttpOnly`, `Secure`, `SameSite=Lax`, podpisane HMAC. Zmiana hasła lub usunięcie konta wylogowuje tę osobę na wszystkich urządzeniach.
- Po 10 nieudanych logowaniach z jednego adresu – 15 minut blokady.
- **Kod odkrywania nazwisk to tylko zasłona przed osobami patrzącymi na ekran** – właściwą ochroną jest logowanie.
- Informacja, że ktoś przyjmuje Komunię w domu z powodu choroby, to dane o zdrowiu (art. 9 RODO). Przed wpisaniem prawdziwych danych uzgodnij z parafią i jej inspektorem ochrony danych: podstawę przetwarzania, kto ma konta, gdzie stoi serwer i jak długo trzymać dane. Jeśli baza jest współdzielona z inną aplikacją, ta aplikacja też ma dostęp do tabel Szafarza.
