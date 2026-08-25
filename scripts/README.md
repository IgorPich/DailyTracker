# Testy danych GreekGod

`npm run test:identity` uruchamia wyłącznie deterministyczne regresje na syntetycznych danych z `fixtures/`.
Polecenie nie odczytuje `%APPDATA%` i może być bezpiecznie używane w CI.

`npm run audit:store` jest osobnym, opcjonalnym audytem produkcyjnego Store. Odczytuje Store,
sprawdza ogólne niezmienniki migracji i na końcu potwierdza identyczność pliku oraz SHA-256.
Nie zawiera oczekiwań dotyczących prywatnych identyfikatorów, nazw siłowni ani wyników.

Fixture'y muszą pozostać całkowicie syntetyczne. Nie kopiujemy do repozytorium zrzutów ani rekordów
z prawdziwego Store użytkownika.
