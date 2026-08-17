# Formlog · DailyTracker

Prosta, lokalna aplikacja do śledzenia masy, talii, odżywiania, aktywności i progresu treningowego. Najważniejszym widokiem jest kompaktowy **Coach Report**, który mieści dane potrzebne trenerowi na jednym lub dwóch zrzutach ekranu.

## Funkcje

- Dashboard ze średnimi 7-dniowymi i wykresami masy oraz talii.
- Szybki dziennik dnia z edycją, usuwaniem i sortowaniem wpisów.
- Cztery gotowe szablony treningowe A/B/C/D.
- Serie z ciężarem, powtórzeniami i RIR, poprzednie wyniki oraz historia ćwiczenia.
- Rolling split z sugestią następnego treningu.
- Coach Report dla 7, 14 dni lub własnego zakresu.
- Eksport pełnej kopii JSON, import JSON i eksport dziennika CSV.
- Responsywny, ciemny interfejs na komputer i telefon.

Nie ma logowania, backendu ani zewnętrznej bazy danych.

## Uruchomienie

Wymagany jest Node.js 20.19+ lub 22.12+.

```bash
npm install
npm run dev
```

Vite wyświetli lokalny adres, domyślnie `http://localhost:5173`.

Build produkcyjny:

```bash
npm run build
npm run preview
```

## Gdzie są dane?

Wszystkie dane są przechowywane w `localStorage` bieżącej przeglądarki pod kluczem `formlog.data.v1`. Nie opuszczają urządzenia. Wyczyszczenie danych witryny w przeglądarce może je usunąć, dlatego warto regularnie pobierać kopię JSON w Ustawieniach.

## Struktura

```text
src/
├── components/       # współdzielone elementy UI i tooltip wykresu
├── context/          # stan aplikacji i operacje na danych
├── data/             # domyślne szablony treningowe A–D
├── pages/            # Dashboard, Dziennik, Trening, Coach Report, Ustawienia
├── utils/            # daty, obliczenia, localStorage, eksport, identyfikatory
├── App.tsx            # układ i nawigacja
├── main.tsx           # punkt startowy React
├── styles.css         # kompletny responsywny wygląd
└── types.ts           # typy danych domenowych
```
