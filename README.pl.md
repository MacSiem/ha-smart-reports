# Smart Reports — instrukcja po polsku

Smart Reports 4.3 pokazuje energię i koszty z historii Home Assistant, stan automatyzacji oraz stan encji. [Pełna dokumentacja i opcje konfiguracji](README.md) są dostępne po angielsku.

## Instalacja i aktualizacja

1. W HACS wyszukaj **Smart Reports** w kategorii Dashboard i pobierz aktualne wydanie.
2. Odśwież przeglądarkę, aby załadować nowy plik karty.
3. W edycji dashboardu dodaj kartę **Smart Reports**. Domyślnym wariantem w selektorze jest **Skrót**.

Podstawowa karta wymaga Home Assistant 2024.1.0 lub nowszego. Opcjonalny **Kalendarz · Energia HA** korzysta z HA Tools Email 2.4.2 lub nowszego; ten backend wymaga HA 2024.7.0. Sam backend raportów kalendarzowych nie wymaga skonfigurowania SMTP.

Jeśli zainstalowany jest również pakiet **HA Tools — Email & Reports**, zaktualizuj go do 4.9 lub nowszego i odśwież przeglądarkę. Oba pakiety dostarczają ten sam komponent Smart Reports; przeglądarka korzysta z pierwszej załadowanej definicji. Zachowaj dotychczasową konfigurację kart i historię Recorder.

## Pierwszy raport i dwa niezależne źródła

Po zainstalowaniu zasobu karty zgodnie z instrukcją produktu dodaj:

```yaml
type: custom:ha-smart-reports
```

Pominięte `variant` oznacza Pełny, a początkową zakładką jest Energia. Wybierak nowej karty może utworzyć Skrót. Domyślnie raport otwiera Wybrane statystyki, korzysta ze źródeł panelu Energia HA, pokazuje 7 dni i ma wyłączone porównanie. Brak statystyki importu w panelu Energia powoduje komunikat konfiguracyjny, bez zgadywania czujnika i bez zastępowania historii bieżącym odczytem.

**Wybrane statystyki** czytają Recorder. Działają bez HA Tools Email i bez SMTP, o ile bieżące konto może odczytać odpowiednie dane HA. Tryb źródeł w edytorze wybiera Panel energii albo Wybrane statystyki wskazane ręcznie. Opcja `energy_source_mode` dotyczy właśnie tego raportu.

**Kalendarz · Energia HA** wybierasz w pełnym widoku Energia. Potrzebuje zgodnego backendu HA Tools Email oraz potwierdzonego dostępu, ale nie konfiguracji SMTP. Zawsze korzysta ze źródeł Energia HA. Ręczna lista statystyk karty nie nadpisuje kalendarza. Po wybraniu kalendarza otwórz **Data i porównanie**, wybierz okres, datę i dostępne odniesienie. Kalendarz startuje od Dnia i Poprzedniego okresu. Nie ma opcji YAML ustawiającej ten tryb, datę kalendarza albo jego odniesienie; `default_tab: energy` wybiera tylko początkową zakładkę pełnego raportu.

## Dokładny okres i rzeczywiste odniesienie

Wszystkie daty odnoszą się do strefy czasowej HA pokazanej w raporcie. Początek należy do przedziału, koniec już nie. Dzień zmiany czasu może mieć 23 lub 25 godzin.

| Raport i wybór | Zakres | Porównanie |
|---|---|---|
| Recorder: Dzisiaj | Od lokalnej północy do ostatniej zakończonej godziny UTC | Obie lokalne granice przesunięte o 1 dzień wstecz |
| Recorder: 7 dni | Dzisiaj i 6 poprzednich lokalnych dat, do ostatniej zakończonej godziny UTC | Obie granice przesunięte o 7 dni wstecz |
| Recorder: 30 dni | Dzisiaj i 29 poprzednich lokalnych dat, do ostatniej zakończonej godziny UTC | Obie granice przesunięte o 30 dni wstecz |
| Kalendarz: Dzień | Lokalny dzień wybranej daty | Poprzedni okres; Ten sam dzień tygodnia; Średnia z 7 poprzednich dni |
| Kalendarz: Tydzień | Tydzień zaczynający się w poniedziałek | Poprzedni okres; Ten sam okres rok temu |
| Kalendarz: Miesiąc | Od pierwszego dnia miesiąca | Poprzedni okres; Ten sam okres rok temu |
| Kalendarz: Rok | Od 1 stycznia | Poprzedni okres; Ten sam okres rok temu |

Dla zakończonego okresu kalendarzowego koniec wypada na początku następnego okresu. Bieżący okres kończy się na ostatniej zakończonej godzinie. Porównanie części bieżącego okresu wyrównuje odpowiednią lokalną granicę. Rok wcześniej dla tygodnia oznacza odpowiadający tydzień ISO poprzedniego roku ISO; brak takiego tygodnia pozostawia odniesienie niedostępne. W widoku Rok oba dostępne odniesienia prowadzą do poprzedniego roku kalendarzowego. Zawsze sprawdzaj podane daty.

W Recorderze porównanie włączasz kontrolką **Porównaj poprzedni okres kalendarza lokalnego** lub `compare_previous_period: true`. Nazwa kontrolki nie zmienia 7 dni w tydzień ani 30 dni w miesiąc kalendarzowy. Te zakresy nie są też zawsze równe dokładnie 168 i 720 godzinom. Brak wymaganych pomiarów pozostaje brakiem danych; zerowa baza nie daje procentu. Procent w Recorderze wymaga dodatniej bazy. Energia i koszt mogą mieć różną dostępność porównania. Dzisiejsza stała stawka nie tworzy historycznego porównania kosztu.

## Ręcznie wskazane źródła

Wszystkie poniższe identyfikatory `sensor.example_*` i nazwy są syntetyczne. Zastąp je istniejącymi identyfikatorami zapisanych statystyk z własnej instalacji. To przykład konfiguracji, bez przykładowych pomiarów w produkcie.

```yaml
type: custom:ha-smart-reports
energy_source_mode: explicit
energy_total_statistics:
  - sensor.example_grid_import_energy
energy_device_statistics:
  - statistic_id: sensor.example_heat_pump_energy
    label: Przykładowa pompa ciepła
energy_cost_statistics:
  - sensor.example_grid_import_cost
compare_previous_period: true
```

Statystyka sumy musi być odpowiednią statystyką energii z historią Recorder. Urządzenia są rozbiciem sumy, a nie kolejnymi składnikami do dodania do importu. Statystyka kosztu musi mieć jednostkę zgodną z walutą HA. Sam podobny identyfikator encji ani bieżąca wartość sensora nie potwierdza istnienia wymaganej historii.

## Jawny szacunek kosztu

```yaml
type: custom:ha-smart-reports
energy_source_mode: dashboard
energy_cost_mode: flat_rate_estimate
energy_price: 0.42
currency: PLN
```

Stawka 0.42 jest syntetycznym przykładem, a nie wartością domyślną ani zaleceniem taryfy. Wpisz własną liczbę nieujemną i walutę. W tym trybie koszt jest szacunkiem na podstawie kompletnego zużycia, bez dodawania brakujących pozycji rachunku. Ta konfiguracja dotyczy Wybranych statystyk i nie zmienia historycznych stawek kalendarza.

## Aktualne ustawienia edytora

Tabela poniżej podaje pola edytora, ich nazwy PL/EN, klucze i wartości domyślne. **Początkowy raport** wybiera początkową zakładkę pełnego raportu spośród włączonych. Jeżeli wskazana zakładka jest ukryta, karta użyje pierwszej włączonej. Nie jest to ustawienie kalendarza, jego daty ani podwidoku energii.

Przykład skrótu z otwarciem w osobnym oknie:

```yaml
type: custom:ha-smart-reports
variant: compact
tap_target: panel
default_tab: energy
show_help: true
```

To konfiguracja istniejącego wariantu. Przy `tap_target: full` raport rozwija się w tej samej karcie. Kalendarz wybierasz dopiero wewnątrz pełnego raportu. Gdy Energia jest włączona, Compact i Tile zachowują skrót energii również wtedy, gdy początkową zakładką pełnego raportu są Automatyzacje lub System.

| Pole PL / EN | Klucz / Key | Wartości / Values | Domyślnie / Default |
|---|---|---|---|
| Tytuł / Title | `title` | Tekst / Text | `Smart Reports` |
| Waluta / Currency | `currency` | Tekst, wymagany dla jawnego szacunku / Text, required for an explicit estimate | Brak jawnej wartości / No explicit value |
| Tryb źródeł / Source mode | `energy_source_mode` | `dashboard`, `explicit` | `dashboard` |
| Otwórz raport / Open report in | `tap_target` | `full`, `panel` | `full` |
| Widok / View | `variant` | `full`, `compact`, `tile` | `full`; wybierak/picker: `compact` |
| Początkowy raport / Initial report | `default_tab` | `energy`, `automations`, `system` | `energy` |
| Identyfikatory statystyk zużycia / Total statistic IDs | `energy_total_statistics` | Lista identyfikatorów / ID list | `[]` |
| Identyfikatory statystyk urządzeń / Device statistic IDs | `energy_device_statistics` | Lista ID lub obiektów / ID or object list | `[]` |
| Identyfikatory statystyk kosztów / Cost statistic IDs | `energy_cost_statistics` | Lista identyfikatorów / ID list | `[]` |
| Tryb kosztu / Cost mode | `energy_cost_mode` | `auto`, `cost_statistics`, `flat_rate_estimate`, `configured_tariff` | `auto` |
| Stała stawka za kWh / Flat rate per kWh | `energy_price` | Liczba skończona ≥ 0 / Finite number ≥ 0 | Brak / None |
| Pokaż pomoc / Show help | `show_help` | `true`, `false` | `true`, tylko Full / Full only |

Trzy listy statystyk są widoczne dla trybu `explicit`. Edytor przyjmuje nowe linie lub przecinki i usuwa duplikaty. Zachowuje istniejące etykiety i relacje nadrzędne dla pozostawionych identyfikatorów. / The three statistic lists are shown for `explicit`. The editor accepts newlines or commas, removes duplicates and preserves existing labels and parent relationships for retained IDs.

`compare_previous_period` jest przełącznikiem raportu i opcją YAML, domyślnie `false`. `show_energy`, `show_automations`, `show_system` i `show_support` są opcjami YAML, domyślnie `true`; nie są dodatkowymi polami obecnego edytora. Wyłączenie wszystkich trzech zakładek pokazuje komunikat konfiguracyjny i zatrzymuje odczyty danych HA. / `compare_previous_period` is a report control and YAML option, default `false`. `show_energy`, `show_automations`, `show_system` and `show_support` are YAML options, default `true`, not additional fields in the current editor. Disabling all three report tabs shows a configuration message and stops HA data reads.

Starszy alias `compact: true` wybiera Compact, jeżeli nie podano poprawnego `variant`. `energy_entity` pozostaje pojedynczym źródłem sumy tylko w trybie explicit z pustą listą sum. Nie dodano ich do przykładów nowej konfiguracji. / The legacy `compact: true` alias selects Compact when no valid `variant` is supplied. `energy_entity` remains a single total-source alias only in explicit mode with an empty total list. New configuration examples do not need these aliases.

| Tryb kosztu / Cost mode | Zachowanie PL | Behavior EN |
|---|---|---|
| `auto` | Najpierw skonfigurowane statystyki kosztu. Tylko bez nich możliwy jest jawny szacunek. Niekompletne koszty nie powodują przejścia na szacunek. | Configured cost statistics first. An explicit estimate is possible only when none are configured. Incomplete costs do not trigger an estimate. |
| `cost_statistics` | Wymaga zgodnych statystyk kosztu; bez nich koszt niedostępny. | Requires compatible cost statistics; otherwise cost is unavailable. |
| `flat_rate_estimate` | Korzysta z podanej stawki, waluty i kompletnej energii, pomijając statystyki kosztu dla tego obliczenia. | Uses the supplied rate, currency and complete energy, ignoring cost statistics for this calculation. |
| `configured_tariff` | Wycena zmierzonych godzin według poprawnego lokalnego `tariff_profile` albo potwierdzonych wspólnych ustawień. Wspólny edytor wymaga backendu i osobnych uprawnień. | Prices measured hours using a valid local `tariff_profile` or confirmed shared settings. The shared editor requires the backend and separate permissions. |

## Dostęp i świadomy eksport

Administrator może zarządzać polityką **Dostęp do funkcji HA Tools** w ustawieniach. Domownik może czytać kalendarz i zapisywać jego lokalny eksport, jeśli pozwala bieżąca polityka oraz uprawnienia HA do źródeł. Nie otrzymuje przez to prawa do zmiany polityki, taryf ani wysyłania poczty. Ukrycie zakładki przez `show_energy: false` jest ustawieniem prezentacji, a nie serwerowym ACL.

Otwórz JSON albo CSV, sprawdź nazwę pliku, format, pola i pełny podgląd, a następnie świadomie wybierz Zapisz. Domyślne aliasy nie usuwają wrażliwości samych pomiarów. Pola prywatne wymagają osobnego wyboru dla każdego nowego eksportu. Podgląd nie zapisuje pliku, zapis lokalny nie wysyła SMTP, a rozpoczęte pobieranie nie potwierdza zapisu na dysku.

Recorder eksportuje JSON schematu 2 albo 3 z porównaniem; CSV zawiera także pełny JSON w wierszu `reviewed_full_document`. Kalendarz eksportuje schemat 4, a jego CSV ma kolumny `row_type,path,value_type,value` i po jednym polu w wierszu. Najpierw odczytaj reguły CSV, potem typy lub osadzony JSON. Brak pozostaje `null`, zmierzone zero pozostaje zerem, a historyczne stawki kalendarza pozostają danymi z przyjętego raportu.

## Koszty i porównania

Zarejestrowane statystyki kosztu zachowują własną historię. Kalendarz używa historycznych wersji taryfy dla przedziałów, które te wersje obejmują. Energia, opłaty zmienne i stałe opłaty gospodarstwa są pokazywane osobno. Stała opłata okresowa nie jest doliczana ponownie do każdego urządzenia ani pokoju.

Porównanie całych okresów i porównanie wspólnych pomiarów mogą mieć różne pokrycie. Raport opisuje zakres i pozostawia niedostępne wartości, gdy brakuje pomiarów, stawek lub zgodności waluty i cen brutto/netto. Udział taniej strefy wymaga jawnego oznaczenia stref w taryfie.

## Warianty i dodawanie do dashboardu

**Kafelek** jest pojedynczym wejściem do raportu. **Skrót** pokazuje najważniejsze wartości i przycisk otwarcia. **Pełny** zachowuje wszystkie widoki, dane i opcjonalną pomoc.

W edytorze ustaw **Początkowy raport** oraz **Otwórz raport**: w tej karcie albo w pełnym oknie. Zamknięcie okna lub powrót ze szczegółów przywraca fokus do przycisku otwarcia. Zmiana wariantu nie usuwa pozostałych ustawień karty.

Administrator może w pełnej karcie użyć **Dodaj do mojego dashboardu**, wybrać istniejący dashboard i widok, obejrzeć podgląd oraz nacisnąć **Dodaj**. Obsługiwane są Sections, Masonry i pusty Panel. Widoki YAML, strategie i zajęty Panel pozostają tylko do odczytu.

**Cofnij** działa do zamknięcia tego okna i przywraca potwierdzoną konfigurację. Nowsza zmiana dashboardu blokuje cofnięcie. Przy niepotwierdzonym zapisie użyj **Sprawdź wynik (tylko odczyt)**; ta operacja nie wysyła kolejnego zapisu.
