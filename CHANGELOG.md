# Muutosloki

Muoto noudattaa [Keep a Changelog](https://keepachangelog.com/fi/1.1.0/) -tapaa ja versiointi [semveriä](https://semver.org/lang/fi/).

## [Julkaisematon]

### Muutettu
- README on nyt englanniksi ja tarkistettu koodia vasten (kutsuraja, cassette-täsmäytys, `--update-baseline`, `--cassette-mode`).
- CLI:n ohje (`--help`), virheilmoitukset ja konsoliraportti ovat nyt englanniksi. Poistumiskoodit, lippujen nimet, oletusarvot, JSON-raportin rakenne ja baseline-muoto eivät muutu.
- JSON-raportin ja vertailun tekstikentät (`failures`, `error`, regression `reason`) ovat englanniksi, esimerkiksi `response does not contain 'x'` ja `error: ...`. Kentät ja niiden tyypit pysyvät ennallaan.
- Kun tallenne puuttuu `--cassette`-ajossa, viesti neuvoo ajamaan `--cassette-mode record`. Aiempi viesti neuvoi asettamaan `LLM_CASSETTE_MODE=record`, mutta evalkit antaa tilan aina itse, joten ympäristömuuttuja ei vaikuta.
- Tuntematon `--cassette-mode` -arvo antaa englanninkielisen virheen (`replay`, `record` tai `auto`).

## [0.3.0] - 2026-10-17

Ensimmäinen npm-julkaisu.

### Lisätty
- Julkaisu npm:ään nimellä `@tonyweckstrom/evalkit`; `npx @tonyweckstrom/evalkit` toimii ilman asennusta.
- `--version` / `-v`. Versio luetaan `package.json`:sta, joten se ei voi poiketa julkaistusta versiosta.
- README: Asennus, esimerkkituloste, "Vaihtoehtoja ja miksi tämä".
- CI: `paketti`-työ pakkaa paketin, asentaa sen puhtaaseen kansioon ja ajaa `validate`-komennon sekä cassette-ajon, jossa baseline täsmää, ja ajon, jossa regressio kaataa poistumiskoodilla 1.
- `prepublishOnly` ajaa tyyppitarkistuksen ja testit ennen julkaisua.

### Muutettu
- `llm-cassette`-riippuvuus tulee nyt npm:stä (`@tonyweckstrom/llm-cassette@^0.2.0`) eikä GitHubista kiinnitetyllä commitilla. `--cassette` vaatii edelleen tämän paketin (valinnainen peer-riippuvuus).
- Kirjastokäytössä tuonti on `@tonyweckstrom/evalkit`.

## [0.2.0]

Ei julkaistu npm:ään. GitHub Action (`validate` ja `run`), `validate`-komento, `--cassette`.

## [0.1.0]

Ei julkaistu npm:ään. Ensimmäinen versio: eval-ajo, baseline ja CLI.
