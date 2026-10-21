# Smart Reports — instrukcja po polsku

Smart Reports 4.3 pokazuje energię i koszty z historii Home Assistant, stan automatyzacji oraz stan encji. [Pełna dokumentacja i opcje konfiguracji](README.md) są dostępne po angielsku.

## Instalacja i aktualizacja

1. W HACS wyszukaj **Smart Reports** w kategorii Dashboard i pobierz aktualne wydanie.
2. Odśwież przeglądarkę, aby załadować nowy plik karty.
3. W edycji dashboardu dodaj kartę **Smart Reports**. Domyślnym wariantem w selektorze jest **Skrót**.

Podstawowa karta wymaga Home Assistant 2024.1.0 lub nowszego. Opcjonalny **Kalendarz · Energia HA** korzysta z HA Tools Email 2.4.2 lub nowszego; ten backend wymaga HA 2024.7.0. Sam backend raportów kalendarzowych nie wymaga skonfigurowania SMTP.

Jeśli zainstalowany jest również pakiet **HA Tools — Email & Reports**, zaktualizuj go do 4.9 lub nowszego i odśwież przeglądarkę. Oba pakiety dostarczają ten sam komponent Smart Reports; przeglądarka korzysta z pierwszej załadowanej definicji. Zachowaj dotychczasową konfigurację kart i historię Recorder.

## Pierwszy raport energii

W pełnej karcie otwórz **Energia**, następnie wybierz źródło:

- **Wybrane statystyki** odczytują zadeklarowane źródła Recorder. Domyślnie korzystają z konfiguracji panelu Energia HA. Tryb jawnych statystyk pozwala wybrać inne źródła.
- **Kalendarz · Energia HA** pokazuje dni, tygodnie, miesiące i lata z konfiguracji Energia HA. Dostęp bieżącego użytkownika musi być dopuszczony w HA Tools Email.

Wybierz datę i odniesienie w **Data i porównanie**. Wykres i **Dane** przedstawiają tę samą odczytaną migawkę. Dostępne odniesienia zależą od okresu: poprzedni okres, ten sam dzień tygodnia, średnia siedmiu okresów lub rok wcześniej. Pełne daty, strefa czasowa, pokrycie i dokładne wartości pozostają dostępne w szczegółach.

Brak pomiaru oznacza brak danych; zmierzone zero pozostaje zerem. Częściowe pokrycie nie potwierdza pełnego zużycia za okres. **Bez pokoju**, **Bez piętra** i **Niezmierzone** mają oddzielne znaczenia. Podliczniki zawarte w nadrzędnym urządzeniu nie zwiększają ponownie sumy gospodarstwa.

## Koszty i porównania

Zarejestrowane statystyki kosztu zachowują własną historię. Kalendarz używa historycznych wersji taryfy dla przedziałów, które te wersje obejmują. Energia, opłaty zmienne i stałe opłaty gospodarstwa są pokazywane osobno. Stała opłata okresowa nie jest doliczana ponownie do każdego urządzenia ani pokoju.

Porównanie całych okresów i porównanie wspólnych pomiarów mogą mieć różne pokrycie. Raport opisuje zakres i pozostawia niedostępne wartości, gdy brakuje pomiarów, stawek lub zgodności waluty i cen brutto/netto. Udział taniej strefy wymaga jawnego oznaczenia stref w taryfie.

## Warianty i dodawanie do dashboardu

**Kafelek** jest pojedynczym wejściem do raportu. **Skrót** pokazuje najważniejsze wartości i przycisk otwarcia. **Pełny** zachowuje wszystkie widoki, dane i opcjonalną pomoc.

W edytorze ustaw **Początkowy raport** oraz **Otwórz raport**: w tej karcie albo w pełnym oknie. Zamknięcie okna lub powrót ze szczegółów przywraca fokus do przycisku otwarcia. Zmiana wariantu nie usuwa pozostałych ustawień karty.

Administrator może w pełnej karcie użyć **Dodaj do mojego dashboardu**, wybrać istniejący dashboard i widok, obejrzeć podgląd oraz nacisnąć **Dodaj**. Obsługiwane są Sections, Masonry i pusty Panel. Widoki YAML, strategie i zajęty Panel pozostają tylko do odczytu.

**Cofnij** działa do zamknięcia tego okna i przywraca potwierdzoną konfigurację. Nowsza zmiana dashboardu blokuje cofnięcie. Przy niepotwierdzonym zapisie użyj **Sprawdź wynik (tylko odczyt)**; ta operacja nie wysyła kolejnego zapisu.

## Eksport i prywatność

Przed pobraniem CSV lub JSON sprawdź nazwę pliku, zakres i pełny podgląd. Raport kalendarzowy korzysta ze schematu 4. Domyślnie nazwy i identyfikatory źródeł są zastępowane aliasami; prywatne pola wymagają osobnego świadomego wyboru dla danego eksportu.

CSV zachowuje typy i dokładne wartości. Komórki przypominające formuły arkusza mogą mieć ochronny apostrof. Braki, zera i opłaty pozostają rozróżnione.

Plik powstaje lokalnie w przeglądarce. Jeżeli przeglądarka pyta o miejsce zapisu, dokończ jej okno **Zapisz** albo je anuluj. Komunikat o rozpoczęciu pobierania nie potwierdza jeszcze zapisu na dysku.

Karta nie wysyła eksportu ani wiadomości email, nie ma telemetrii i nie przechowuje danych logowania SMTP. Utrata uprawnień czyści chroniony raport i podgląd eksportu. Przed udostępnieniem pliku sprawdź jego rzeczywistą zawartość. Linki wsparcia otwierają się dopiero po kliknięciu.
