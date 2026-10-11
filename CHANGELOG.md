# Changelog

## [2026-10-11] - README: popis projektu, stack a spuštění (EN + CZ)

## [2026-09-28] - Objevování jen výběrem z návrhů
- Zrušeno ruční míchání prvních 5 barev (`FREE_PICK_LIMIT`); objevuje se vždy výběrem ze 3 vygenerovaných barev
- Picker už nepodporuje celé spektrum, jen okno odstínů při hádání

## [2026-09-28] - Pozadí pickeru ukazuje celou škálu
- Místo jednolité barvy je na pozadí pole odstín × světlost při aktuální sytosti (canvas 72×48, roztažený přes plochu)
- Vybraná barva je výplň kolečka kurzoru; okrajové proužky odstínu/světlosti odstraněny (pole je nahrazuje)

## [2026-09-28] - Tipování jen z výřezu spektra
- Picker při hádání nabízí jen 90° odstínů (`HUE_WINDOW`); cíl leží v okně stabilně na 10–90 %, nikdy na kraji
- `/api/next` vrací `hueFrom`; objevování barev dál přes celé spektrum

## [2026-09-25] - MVP hry Colormind
- Hádání barvy podle nápověd ostatních hráčů, plynulý OKLCH picker přes celou obrazovku
- Skóre podle CIEDE2000 (0–100), odhalení diagonálním řezem, hodnocení nápověd 👍
- Objevování nových barev po vyčerpání poolu (prvních 5 barev se míchá ručně, pak výběr ze 3 návrhů)
- Cloudflare Workers + D1, historie hráče v localStorage

## [2026-09-25] - Nasazení na Cloudflare
- D1 databáze `colormind` (EEUR), Worker na https://colormind.guth.workers.dev

## [2026-09-25] - Hráčská historie
- Obrazovka Historie: odehrané, objevené a čekající barvy; odznak nových nápověd
- Detail barvy se všemi nápovědami (👍, označení vlastních a nových), dodatečné napsání nápovědy
- Hraní konkrétní neodehrané barvy; endpointy `/api/history`, `/api/color`, `/api/next?id=`

## [2026-09-25] - Admin rozhraní
- `/admin` chráněný heslem (`ADMIN_TOKEN` secret, lokálně `.dev.vars`)
- Přehled (počty, aktivita 7 dní), barvy s trendem prvních 5 → posledních 5 tipů a grafem skóre v čase
- Skrývání barev a nápověd (i všech od hráče), přejmenování barev, úprava otázek u barvy
- Správa banky otázek (přidat, upravit, deaktivovat); migrace `0002_admin.sql`
