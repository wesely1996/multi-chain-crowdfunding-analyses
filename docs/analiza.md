# Analiza implementacione kompleksnosti i rezultati merenja performansi

## 1. Uvod

Ovaj dokument predstavlja sistematsku analizu dva ključna aspekta višelančane crowdfunding platforme razvijene u okviru master rada: (1) implementacionu kompleksnost tri klijentske biblioteke (TypeScript, .NET/C#, Python) koje pokrivaju pet varijanti pametnih ugovora, i (2) zaključke izvedene iz kvantitativnih merenja performansi na lokalnim testnim mrežama. Analiza obuhvata pet varijanti ugovora: V1 (ERC-20), V2 (ERC-4626), V3 (ERC-1155), V4 (Solana SPL Token) i V5 (Solana Token-2022). Cilj dokumenta je da pruži empirijsku osnovu za komparativnu evaluaciju inženjerske složenosti i operativnih karakteristika implementacija na EVM i Solana platformama.

---

## 2. Analiza implementacione kompleksnosti klijentskih biblioteka

### 2.1 Metodologija

Kompleksnost svake klijentske implementacije evaluirana je prema pet dimenzija: (1) stepen iskorišćenosti okvira i biblioteka (framework leverage), (2) obim dupliranja koda, (3) opterećenje manuelnom implementacijom funkcionalnosti koje bi okvir trebalo da pruži, (4) kvalitet paralelizacije RPC poziva, i (5) čitljivost i održivost koda. Svaka dimenzija ocenjena je na skali od 1 do 10, gde viša ocena označava povoljniji rezultat. Obim koda (LOC) meren je bez praznih linija i komentara. RPC obrasci analizirani su nakon optimizacija sprovedenih tokom razvoja.

### 2.2 TypeScript klijent

**Obim koda.** TypeScript klijent obuhvata ukupno ~495 LOC (248 LOC za EVM interakcije, 247 LOC za Solana interakcije), čime predstavlja najkompaktniju implementaciju.

**Iskorišćenost okvira.** Na EVM strani, biblioteka Viem pruža tipski bezbedne pozive ugovora, automatsko dekodiranje događaja i čekanje potvrde transakcija. Na Solana strani, Anchor SDK (@coral-xyz/anchor 0.32) generiše TypeScript klijente direktno iz IDL specifikacije programa — izgradnja instrukcija, serijalizacija naloga i razrešavanje PDA adresa u potpunosti su automatizovani od strane okvira.

**Manuelni rad.** Uprkos visokom stepenu automatizacije, određene operacije zahtevaju ručnu implementaciju: parsiranje logova događaja (iteracija kroz `receipt.logs`), funkcije za izvođenje PDA adresa, i ekstrakcija promene stanja vault naloga iz metapodataka transakcije (`tx.meta.preTokenBalances/postTokenBalances`) prilikom operacije povlačenja sredstava (withdraw). Poslednje rešenje, iako funkcionalno ispravno, zavisi od stabilnosti strukture metapodataka transakcije, što predstavlja potencijalni rizik pri budućim promenama Solana runtime-a.

**Paralelizacija.** EVM status operacija izvršava 13 RPC poziva paralelno putem `Promise.all`. Solana withdraw operacija koristi 3 poziva, od kojih se dva (`getTransaction` i `account.fetch`) izvršavaju paralelno nakon slanja transakcije. Ukupan kvalitet paralelizacije ocenjen je kao visok.

**Ocena: 8.2/10** (ponderisani prosek svih pet dimenzija).

### 2.3 .NET/C# klijent

**Obim koda.** .NET klijent obuhvata ~534 LOC osnovnog koda (288 LOC za EVM, 246 LOC za Solana), uz dodatnih 232 LOC u modulu `InstructionBuilder.cs` i 48 LOC za manuelnu Borsh deserijalizaciju u `FetchCampaignState`. Ukupan efektivni obim iznosi ~814 LOC, što je značajno više od TypeScript implementacije.

**Iskorišćenost okvira.** Na EVM strani, Nethereum biblioteka pruža solidnu apstrakciju za pozive ugovora, ali zahteva ručno definisanje DTO struktura za događaje (~60 LOC šablonskog koda) i prilagođenu petlju za čekanje potvrde transakcije (`WaitForReceipt`). Na Solana strani, ne postoji zreli .NET ekvivalent Anchor SDK-a. Modul `InstructionBuilder.cs` (232 LOC) ručno reprodukuje funkcionalnost koju Anchor TS generiše automatski iz IDL-a — uključujući proračun diskriminatora, sastavljanje lista naloga i Borsh serijalizaciju parametara instrukcija. Modul `FetchCampaignState` (48 LOC) ručno deserijalizuje sirove bajtove naloga prema fiksiranim pomerajima (8 bajtova diskriminator, zatim 32+32+32 bajta za javne ključeve, potom u64 polja itd.).

**Manuelni rad.** .NET klijent nosi najveće opterećenje manuelnom implementacijom od sve tri biblioteke. Posebno se ističu dva kritična problema sa aspekta održivosti:

- **Krhkost deserijalizacije.** `FetchCampaignState` koristi hardkodirane pomeraje bajtova. Bilo kakva promena šeme ugovora (dodavanje ili preuređivanje polja) tiho će pokvariti parsiranje naloga bez ikakve greške pri kompilaciji. Ne postoji mehanizam verzionisanja šeme.
- **Duplikacija logike.** Proračun iznosa za povlačenje po fazama (`milestone amount`) u .NET klijentu duplira matematiku iz Anchor programa na lancu: `amount = (mIdx >= milestoneCount-1) ? totalRaised - totalWithdrawn : totalRaised * milestones[mIdx] / 100`. Ova logika mora biti ručno sinhronizovana sa Rust implementacijom pri svakoj izmeni.

**Paralelizacija.** Nakon optimizacija sprovedenih tokom razvoja, EVM status operacija izvršava 13 paralelnih RPC poziva putem `Task.WhenAll`. Solana withdraw operacija svedena je na 2 poziva (pre-dohvat stanja + slanje transakcije), čime je eliminisan redundantni post-dohvat. Kvalitet paralelizacije je visok.

**Ocena: 6.8/10** (ponderisani prosek) — najniža ocena od tri implementacije, pretežno usled odsustva zrelog Solana SDK-a za .NET ekosistem.

### 2.4 Python klijent

**Obim koda.** Python klijent obuhvata ukupno ~1.146 LOC (510 LOC za EVM, 636 LOC za Solana), čime predstavlja najobimniju implementaciju. Veći obim delimično se objašnjava eksplicitnijim stilom pisanja karakterističnim za Python i većim brojem pomoćnih funkcija.

**Iskorišćenost okvira.** Na EVM strani, Web3.py biblioteka pruža solidnu apstrakciju; ABI specifikacije učitavaju se iz Hardhat artefakata i keširaju putem `@lru_cache` dekoratora. Na Solana strani, anchorpy biblioteka pruža IDL-vođenu apstrakciju uporedivu sa Anchor TS — pozivi metoda `program.rpc[]` automatski upravljaju izgradnjom instrukcija, serijalizacijom i deserijalizacijom naloga.

**Manuelni rad.** Minimalan — uglavnom se svodi na izvođenje PDA adresa, razrešavanje ATA (Associated Token Account) adresa i orkestraciju asinhronih operacija.

**Paralelizacija.** EVM status operacija izvršava 6 sekvencijalnih RPC poziva. Web3.py koristi sinhroni HTTP transport koji ne podržava nativno grupisanje (batching) bez eksplicitnog korišćenja `concurrent.futures` modula. Ovo predstavlja najslabiji aspekt Python implementacije. Solana operacije koriste 2 poziva (slanje + potvrda), što je uporedivo sa ostalim klijentima.

**Ocena: 8.0/10** (ponderisani prosek) — visoka ocena zahvaljujući odličnoj iskorišćenosti okvira i minimalnom manuelnom radu, ali umanjeno niskim kvalitetom paralelizacije na EVM strani.

### 2.5 Uporedna tabela

#### Tabela 1: Obim koda po klijentu

| Komponenta | TypeScript (LOC) | .NET/C# (LOC) | Python (LOC) |
|---|---|---|---|
| EVM deo | 248 | 288 | 510 |
| Solana deo | 247 | 246 | 636 |
| Dodatni manuelni kod | — | 280 (InstructionBuilder + FetchCampaignState) | — |
| **Ukupno** | **~495** | **~814** | **~1.146** |

#### Tabela 2: RPC obrasci (nakon optimizacija)

| Operacija | TypeScript | .NET/C# | Python |
|---|---|---|---|
| EVM status | 13 paralelnih (Promise.all) | 13 paralelnih (Task.WhenAll) | 6 sekvencijalnih |
| Solana withdraw | 3 poziva (1+2 paralelna) | 2 poziva (sekvencijalna) | 2 poziva (sekvencijalna) |

#### Tabela 3: Ocene po dimenzijama kompleksnosti

| Dimenzija | TypeScript | .NET/C# | Python |
|---|---|---|---|
| Iskorišćenost okvira | 9/10 | 6/10 | 9/10 |
| Duplikacija koda | 7/10 | 7/10 | 9/10 |
| Manuelno opterećenje | 8/10 | 5/10 | 9/10 |
| Kvalitet paralelizacije | 8/10 | 8/10 | 4/10 |
| Čitljivost | 9/10 | 8/10 | 9/10 |
| **Ponderisani prosek** | **8.2/10** | **6.8/10** | **8.0/10** |

#### Tabela 4: Zajednički problemi kvaliteta koda

| Problem | Pogođeni klijent(i) | Rizik |
|---|---|---|
| Zavisnost od strukture metapodataka transakcije | TypeScript (Solana withdraw) | Srednji — funkcionalno ispravno, ali krhko pri promenama runtime-a |
| Hardkodirani pomeraji bajtova u deserijalizaciji | .NET (FetchCampaignState) | Visok — tihi kvar pri promenama šeme ugovora |
| Duplikacija logike proračuna na lancu | .NET (Withdraw) | Srednji — zahteva ručnu sinhronizaciju sa Rust programom |
| Sekvencijalni RPC pozivi | Python (EVM status) | Nizak — utiče na performanse, ne na korektnost |
| Raspršena logika grananja po varijantama | Svi klijenti | Nizak — utiče na održivost, ne na funkcionalnost |

---

## 3. Zaključci merenja performansi

Sva merenja sprovedena su na lokalnim testnim mrežama (Hardhat in-process EVM node / `solana-test-validator`), sa N=50 sekvencijalnih doprinosa (contribucija) po mernoj sesiji. Rezultati su prikupljeni Python benchmark okruženjem 20. marta 2026. godine.

### 3.1 EVM varijante (V1, V2, V3)

#### 3.1.1 Troškovi operacije contribute

Prosečni gas troškovi za operaciju `contribute` razlikuju se među varijantama:

| Varijanta | Prosek (gas) | Min (gas) | Max (gas) | Razlika vs V1 |
|---|---|---|---|---|
| V1 ERC-20 | 108.026 | 107.000 | 158.300 | — |
| V2 ERC-4626 | 102.606 | — | — | −5,0% |
| V3 ERC-1155 | 128.653 | — | — | +19,1% |

**V2 (ERC-4626) je najekonomičnija EVM varijanta za operaciju contribute.** Ušteda od 5% u poređenju sa V1 objašnjava se činjenicom da je vault samodovoljni ugovor — interni poziv `_mint` eliminiše potrebu za skupim eksternim pozivom (CALL opkod) ka zasebnom CampaignToken ugovoru. V3 (ERC-1155) je najskuplja varijanta (+19,1% u odnosu na V1), što je posledica dvodimenzionalne strukture skladištenja ERC-1155 standarda (`tierContributions[contributor][tierId]`) i emitovanja `TransferSingle` događaja.

**Efekat prvog poziva.** Prva operacija `contribute` u svakoj kampanji je ~50.000 gas skuplja od narednih. Ovaj skok objašnjava se EIP-2929 penalom za hladan pristup skladištu (cold SSTORE) prilikom prelaska `totalRaised` sa nulte na nenultu vrednost, čime se aktivira skuplja operacija kreiranja nove stavke u skladištu.

#### 3.1.2 Troškovi operacije finalize

| Varijanta | Gas |
|---|---|
| V1 ERC-20 | 47.048 |
| V2 ERC-4626 | 47.138 |
| V3 ERC-1155 | 47.092 |

Operacija `finalize` je efektivno nezavisna od korišćenog token standarda — razlika između svih varijanti iznosi manje od 0,2%. Ovo je očekivano, budući da finalizacija menja isključivo stanje kampanje (status, vremensku oznaku) bez interakcije sa token ugovorima.

#### 3.1.3 Troškovi operacije withdrawMilestone

| Indeks faze | V1 (gas) | V2 (gas) | V3 (gas) |
|---|---|---|---|
| 0 (prva) | 93.388 | 93.350 | ≈V1 (±70) |
| 1 (druga) | 59.238 | 59.200 | ≈V1 (±70) |
| 2 (treća) | 50.720 | 50.681 | ≈V1 (±70) |

Uočava se opadajući gradijent troškova: prva faza povlačenja je ~34.150 gas skuplja od druge, a druga je ~8.500 gas skuplja od treće. Gradijent se objašnjava prelaskom sa hladnog na topao pristup skladištu za promenljivu `currentMilestone` i stanje ERC-20 balansa kreatora kampanje. Razlike među varijantama su zanemarljive (<70 gas), jer operacija povlačenja ne zavisi od mehanizma doprinosa.

#### 3.1.4 Troškovi operacije refund

| Varijanta | Prosek (gas) | Razlika vs V1 |
|---|---|---|
| V1 ERC-20 | 72.747 | — |
| V2 ERC-4626 | 67.528 | −7,2% |
| V3 ERC-1155 | 72.890 | ≈V1 |

V2 ponovo demonstrira prednost samodovoljnog vault modela — ušteda od 7,2% pri povratu sredstava (refund) proizlazi iz eliminacije eksternog poziva za spaljivanje (burn) token-a.

#### 3.1.5 Propusnost (TPS)

| Varijanta | TPS |
|---|---|
| V1 ERC-20 | 98,23 |
| V2 ERC-4626 | 89,93 |
| V3 ERC-1155 | 81,97 |

Propusnost opada sa porastom gas troškova po transakciji. Međutim, ove vrednosti su artefakt Hardhat automine režima (svaki blok sadrži tačno jednu transakciju sa trenutnom potvrdom) i ne reflektuju ponašanje na produkcijskim mrežama.

### 3.2 Solana varijante (V4, V5)

#### 3.2.1 Troškovi transakcija

| Operacija | V4 SPL Token (lamporti) | V5 Token-2022 (lamporti) | Latencija (ms) |
|---|---|---|---|
| contribute | 10.000 | 10.000 | ~515 |
| finalize | 5.000 | 5.000 | ~520 |
| withdrawMilestone | 10.000 | 10.000 | ~500 |
| refund | 10.000 | 10.000 | ~516 |

**V4 i V5 su nerazlučive na nivou troškova u lamportima.** Svi iznosi naknada identični su jer Solana koristi model naplate po potpisu (per-signature), a ne po koraku izračunavanja. Operacije sa dva potpisnika (contribute, withdraw, refund) koštaju 10.000 lamporti (2 × 5.000), dok operacije sa jednim potpisnikom (finalize) koštaju 5.000 lamporti.

**Odsustvo gradijenta troškova.** Za razliku od EVM-a, gde troškovi `withdrawMilestone` opadaju sa indeksom faze, na Solani svih pet faza košta identično (10.000 lamporti). Ovo se objašnjava modelom skladištenja na Solani: prostor za podatke prealokira se prilikom kreiranja naloga putem depozita za oslobađanje od rente (rent-exempt deposit), čime se eliminišu penali za prelazak nula→nenulta vrednost koji postoje u EVM modelu.

**Razlika između V4 i V5.** Na nivou lamport naknada, razlika ne postoji. Distinkcija između SPL Token i Token-2022 programa manifestuje se isključivo u potrošnji Compute Unit-a (CU), koja nije merena u ovoj seriji testova. Merenje CU potrošnje ostaje predmet budućeg rada.

#### 3.2.2 Propusnost

| Varijanta | TPS |
|---|---|
| V4 SPL Token | 1,9792 |
| V5 Token-2022 | 1,9725 |

Sekvencijalna propusnost od ~1,98 TPS ograničena je vremenom slot-a na lokalnoj testnoj mreži (~400 ms). Razlika između V4 i V5 (0,3%) nalazi se u okviru mernog šuma.

### 3.3 Međulančano poređenje

#### 3.3.1 Model naplate

Fundamentalna razlika između EVM i Solana platformi leži u modelu naplate transakcija:

| Karakteristika | EVM | Solana |
|---|---|---|
| Jedinica naplate | Gas (proporcionalan računanju) | Lamporti (po potpisu) |
| Zavisnost od složenosti | Da — složenije operacije troše više gas-a | Ne — naknada zavisi od broja potpisnika |
| Gradijent troškova | Prisutan (cold→warm SSTORE) | Odsutan (prealokacija skladišta) |
| Efekat prvog poziva | ~50.000 gas penala | Ne postoji |
| Razlika među varijantama | Značajna (do 25,4% između V2 i V3) | Nepostojeća na nivou naknada |

Ovaj strukturni kontrast ima direktne posledice za dizajn pametnih ugovora: na EVM platformi, izbor token standarda materijalno utiče na operativne troškove, dok na Solani troškovi zavise isključivo od broja potrebnih potpisa.

#### 3.3.2 Propusnost i latencija

| Metrika | EVM (Hardhat) | Solana (localnet) |
|---|---|---|
| Prosečna latencija | 0–18 ms | 512–523 ms |
| Sekvencijalni TPS | 81,97–98,23 | ~1,98 |
| Odnos | ~50× veći TPS | — |

**Upozorenje o interpretaciji.** Razlika od ~50× u propusnosti je artefakt testnog okruženja i ne sme se interpretirati kao stvarna razlika u performansama platformi. Hardhat automine režim trenutno rudari blokove (bez kašnjenja), dok `solana-test-validator` simulira realistično vreme slota (~400 ms). Za smisleno poređenje propusnosti neophodni su podaci sa testnih mreža (Sepolia za EVM, devnet za Solanu), čije prikupljanje je planirano kao naredni korak.

#### 3.3.3 Latencija

Merenja latencije na lokalnim mrežama nisu direktno uporediva usled fundamentalno različitih mehanizama potvrde. EVM Hardhat latencija (0–18 ms) reflektuje samo vreme izvršavanja transakcije bez mrežnog kašnjenja, dok Solana latencija (~500 ms) uključuje čekanje na potvrdu u narednom slotu. Smisleno poređenje latencije zahteva merenja na testnim mrežama sa realističnim mrežnim uslovima.

### 3.4 Nalaz o iskustvu programera (Developer Experience)

#### Tabela 5: Ključni DX pokazatelji

| Metrika | EVM (V1) | Solana (V4) |
|---|---|---|
| LOC ugovora | 296 Solidity (3 datoteke) | 588 Rust (8 datoteka) |
| LOC testova | 475 TypeScript | 642 TypeScript |
| LOC TS klijenta | 521 | 597 |
| LOC C# klijenta | 350 | 551 (sa InstructionBuilder, TransactionHelper, PdaHelper) |
| LOC Python klijenta | 803 | 770 |
| Koraci do prve transakcije | 3 | 10 |
| Šablonsko opterećenje | Nisko | Visoko |

Solana implementacija zahteva približno dvostruko veći obim koda ugovora (588 vs 296 LOC) i trostruko više koraka za inicijalno podešavanje (10 vs 3). Razlika u obimu delimično proizlazi iz eksplicitnog modela naloga na Solani, gde se svaki nalog i njegov životni ciklus moraju eksplicitno definisati u programskom kodu, za razliku od EVM-a gde je skladištenje implicitno vezano za ugovor.

Na strani klijenata, .NET implementacija za Solanu (551 LOC) je značajno obimnija od EVM ekvivalenta (350 LOC), pretežno usled odsustva zrelog SDK-a. TypeScript i Python klijenti, zahvaljujući Anchor SDK i anchorpy bibliotekama, pokazuju ujednačeniji obim koda između lanaca.

---

## 4. Opšti zaključci

Na osnovu sprovedene analize implementacione kompleksnosti i merenja performansi, mogu se formulisati sledeći zaključci:

1. **Izbor token standarda na EVM platformi materijalno utiče na gas troškove.** V2 (ERC-4626) je najefikasnija varijanta za operacije contribute (−5%) i refund (−7,2%), dok je V3 (ERC-1155) najskuplja za contribute (+19,1%). Operacije finalize i withdrawMilestone su nezavisne od token standarda.

2. **Solana model naplate eliminiše varijaciju troškova među varijantama.** V4 i V5 su nerazlučive na nivou lamport naknada, što je strukturna posledica modela naplate po potpisu. Distinkcija će se manifestovati isključivo na nivou Compute Unit potrošnje.

3. **EVM demonstrira izražen gradijent troškova po operacijama**, uključujući efekat prvog poziva (~50.000 gas) i opadajuće troškove povlačenja po fazama (~34.000 gas razlike između prve i druge faze). Solana ne pokazuje ove efekte usled prealokacije skladišta.

4. **TypeScript klijent pruža najbolji odnos kompaktnosti i funkcionalnosti** (495 LOC, ocena 8.2/10), dok .NET klijent trpi najveće opterećenje manuelnom implementacijom (814 LOC, ocena 6.8/10) usled odsustva zrelog Solana SDK-a. Python klijent, uprkos najvećem obimu koda (1.146 LOC), postiže visoku ocenu (8.0/10) zahvaljujući odličnoj iskorišćenosti anchorpy biblioteke, ali zaostaje u paralelizaciji RPC poziva.

5. **Merenja propusnosti na lokalnim mrežama nisu direktno uporediva** između EVM i Solana platformi usled fundamentalno različitih mehanizama potvrde u testnim okruženjima. Razlika od ~50× u TPS vrednostima je artefakt konfiguracije, ne inherentna karakteristika platformi. Prikupljanje podataka sa testnih mreža (Sepolia, devnet) ostaje prioritetan naredni korak za validno međulančano poređenje.

6. **Solana platforma zahteva značajno veći inicijalni napor** za razvoj (dvostruko veći obim koda ugovora, trostruko više koraka za podešavanje), ali nakon uspostavljanja razvojnog okruženja, klijentske biblioteke sa IDL podrškom (Anchor TS, anchorpy) značajno smanjuju kompleksnost integracije na nivo uporediv sa EVM ekosistemom.
