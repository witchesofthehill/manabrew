# Changelog

## [1.0.2](https://github.com/witchesofthehill/manabrew/compare/v1.0.1...v1.0.2) (2026-07-04)

### Fixes

* about page and dockerfile ([#338](https://github.com/witchesofthehill/manabrew/issues/338)) ([2d64135](https://github.com/witchesofthehill/manabrew/commit/2d64135ff87c4114d40d2673242829e95235e084))

## [1.0.1](https://github.com/witchesofthehill/manabrew/compare/v1.0.0...v1.0.1) (2026-07-04)

### Fixes

* globe icon ([#337](https://github.com/witchesofthehill/manabrew/issues/337)) ([b8fead2](https://github.com/witchesofthehill/manabrew/commit/b8fead228ae2f33ac84d28b4a845de27ea272c47))

## [1.0.0](https://github.com/witchesofthehill/manabrew/compare/v0.6.0...v1.0.0) (2026-07-04)

### Features

* **ui:** default tauri play-vs-ai to the forge engine ([#293](https://github.com/witchesofthehill/manabrew/issues/293)) ([72e2eed](https://github.com/witchesofthehill/manabrew/commit/72e2eed8c8d8ec839de16d28a49479304ea2674a))
* proper infrastructure for release ([#329](https://github.com/witchesofthehill/manabrew/issues/329)) ([#330](https://github.com/witchesofthehill/manabrew/issues/330)) ([a833281](https://github.com/witchesofthehill/manabrew/commit/a833281045b48e7e0ab11a74c7f81fd75c8ebb2d))

### Other

* Misc fixes post-release ([#326](https://github.com/witchesofthehill/manabrew/issues/326)) ([1386825](https://github.com/witchesofthehill/manabrew/commit/1386825c57c5457485507ebf41a55e5cf1605280))

## [0.6.0](https://github.com/witchesofthehill/manabrew/compare/v0.5.2...v0.6.0) (2026-07-03)


### Features

* **ui:** multiplayer battlefield accordion scaffold (behind flag) ([#280](https://github.com/witchesofthehill/manabrew/issues/280)) ([17f8d25](https://github.com/witchesofthehill/manabrew/commit/17f8d25652425a1b2bcf5fa247b05d77ee6a0220))
* **ui:** playmat zoom + crop and a sizing info tooltip ([#283](https://github.com/witchesofthehill/manabrew/issues/283)) ([8487bac](https://github.com/witchesofthehill/manabrew/commit/8487bac0ea1f5ae9f355235811f422e156d5df64))


### Fixes

* change fetch strategy on pixi canvas ([#284](https://github.com/witchesofthehill/manabrew/issues/284)) ([39418f2](https://github.com/witchesofthehill/manabrew/commit/39418f23c188943d9f290da372ca385321e5fc70))
* **dev:** harden vite file watching ([#259](https://github.com/witchesofthehill/manabrew/issues/259)) ([0119df8](https://github.com/witchesofthehill/manabrew/commit/0119df892b2119c26a6f96787dcea9c0f1664dc3))
* import deck clarity ([#298](https://github.com/witchesofthehill/manabrew/issues/298)) ([2d8ec33](https://github.com/witchesofthehill/manabrew/commit/2d8ec3361b87a43e30271bc0b92ca2b971ab35ab))
* **ui:** allow targeting opponent public zones ([#282](https://github.com/witchesofthehill/manabrew/issues/282)) ([0b3e092](https://github.com/witchesofthehill/manabrew/commit/0b3e092eaf77b8d39809a8f379812bb0bb516a82))

## [0.5.2](https://github.com/witchesofthehill/manabrew/compare/v0.5.1...v0.5.2) (2026-06-24)

### Fixes

- add more config to graal native-image ([#279](https://github.com/witchesofthehill/manabrew/issues/279)) ([8cc2df3](https://github.com/witchesofthehill/manabrew/commit/8cc2df3dc3f4d5d51fb3b7c47c673ec5a1307f7c))
- **ci:** bump Cargo.lock via release-please config ([#275](https://github.com/witchesofthehill/manabrew/issues/275)) ([a8d50ca](https://github.com/witchesofthehill/manabrew/commit/a8d50ca05d34cab6d8a9760e04b8fc34a36bc383))

## [0.5.1](https://github.com/witchesofthehill/manabrew/compare/v0.5.0...v0.5.1) (2026-06-24)

### Fixes

- **build:** copy release-please manifest into web build context ([#270](https://github.com/witchesofthehill/manabrew/issues/270)) ([88db1c5](https://github.com/witchesofthehill/manabrew/commit/88db1c592c75370f5274680ba028e7ec7bb7dc84))
- bundle binary on macos and windows ([#273](https://github.com/witchesofthehill/manabrew/issues/273)) ([9e007a4](https://github.com/witchesofthehill/manabrew/commit/9e007a448bbc13d66b14c4874ababbea3e84776b))

## [0.5.0](https://github.com/witchesofthehill/manabrew/compare/v0.4.0...v0.5.0) (2026-06-24)

### Features

- **tauri:** Self hosted node with forge bundled ([#264](https://github.com/witchesofthehill/manabrew/issues/264)) ([fe68645](https://github.com/witchesofthehill/manabrew/commit/fe6864595ce092c7cfa04246ea0e2cd1e6f43dab))
- **ui:** add custom default playmat in settings ([#269](https://github.com/witchesofthehill/manabrew/issues/269)) ([10f512f](https://github.com/witchesofthehill/manabrew/commit/10f512f235c4836c01fe51d208d764152200cf6f))
- **ui:** custom playmats and player avatars ([#263](https://github.com/witchesofthehill/manabrew/issues/263)) ([aa522eb](https://github.com/witchesofthehill/manabrew/commit/aa522eb9e8b7dc92fcdd43a60b1640b18516ee8a))
- **ui:** show app version and update check in about ([#268](https://github.com/witchesofthehill/manabrew/issues/268)) ([b82d6a2](https://github.com/witchesofthehill/manabrew/commit/b82d6a2581b4ab5f17ce673343024cd958dd772a))
- **ui:** warn about manabrew engine in offline engine modal ([#261](https://github.com/witchesofthehill/manabrew/issues/261)) ([8462186](https://github.com/witchesofthehill/manabrew/commit/84621865b41b54e79ee22deb1f6c24d413e42021))
- **website:** add blog with launch and technical posts ([#265](https://github.com/witchesofthehill/manabrew/issues/265)) ([c8dc41d](https://github.com/witchesofthehill/manabrew/commit/c8dc41d1b3b37b5d022281651c18c022197d4b44))

### Fixes

- **build:** build website docker stage with yarn ([#267](https://github.com/witchesofthehill/manabrew/issues/267)) ([7140e5b](https://github.com/witchesofthehill/manabrew/commit/7140e5bc8020eedd254a82bd337022bddd8538dc))
- **docker:** generate harness protocol classes ([#257](https://github.com/witchesofthehill/manabrew/issues/257)) ([44e4d1b](https://github.com/witchesofthehill/manabrew/commit/44e4d1bba49a951efe0769dca581792c5b93c50f))
- **forge:** wistfulness not triggering ETB ([#250](https://github.com/witchesofthehill/manabrew/issues/250)) ([7be2953](https://github.com/witchesofthehill/manabrew/commit/7be2953e32c8f2fa59e05988bec51feda322f068))
- **ui:** pixi lifecycle/leak cleanup + dependency security bumps ([#246](https://github.com/witchesofthehill/manabrew/issues/246)) ([09ac213](https://github.com/witchesofthehill/manabrew/commit/09ac2139d737f86c81f0c4c5556785490732b8d1))

## [0.4.0](https://github.com/witchesofthehill/manabrew/compare/v0.3.0...v0.4.0) (2026-06-20)

### ⚠ BREAKING CHANGES

- **website:** the app origin changes to play.manabrew.app, so per-origin localStorage (decks, preferences) does not carry over.

### Features

- cauldron ([#211](https://github.com/witchesofthehill/manabrew/issues/211)) ([cf3efd0](https://github.com/witchesofthehill/manabrew/commit/cf3efd06796cd1d6e56730e3eff975f1e76a29d9))
- **combat:** engine-driven combat prompts, doomed flag, block legality ([#210](https://github.com/witchesofthehill/manabrew/issues/210)) ([69ea5b4](https://github.com/witchesofthehill/manabrew/commit/69ea5b4195eeff714091dc18cc7abf10436157bf))
- **ui:** add battlefield card style options ([#215](https://github.com/witchesofthehill/manabrew/issues/215)) ([6703546](https://github.com/witchesofthehill/manabrew/commit/67035467eb7a145fad41c8290aefdae4cf2fd66e))
- **ui:** add card-name filter to card-list modals ([#196](https://github.com/witchesofthehill/manabrew/issues/196)) ([39a782e](https://github.com/witchesofthehill/manabrew/commit/39a782e9dbddbaf58db3aa8e80e935dd6e91e3de))
- **ui:** board animation toolkit + creature ETB stomp ([#218](https://github.com/witchesofthehill/manabrew/issues/218)) ([8f6ec6c](https://github.com/witchesofthehill/manabrew/commit/8f6ec6c5668c4427a3f359647109cebc7ff6242a))
- **ui:** card preview improvements (p/t badge, loading, loyalty, hints) ([#200](https://github.com/witchesofthehill/manabrew/issues/200)) ([829a39e](https://github.com/witchesofthehill/manabrew/commit/829a39e457cdf250c57754a0c907c06a71fc0812))
- **ui:** deck-editor fixes, keyboard shortcuts, branding & layout polish ([#181](https://github.com/witchesofthehill/manabrew/issues/181)) ([38882b2](https://github.com/witchesofthehill/manabrew/commit/38882b27b9d723538f4272efa3cd0e9155e934c8))
- **ui:** first-launch onboarding modal and about dialog ([#162](https://github.com/witchesofthehill/manabrew/issues/162)) ([18126f9](https://github.com/witchesofthehill/manabrew/commit/18126f927d8676196c64956d53c3e282b67a0b67))
- **ui:** playable draft formats, draft ux overhaul, and pick-race fixes ([#148](https://github.com/witchesofthehill/manabrew/issues/148)) ([ecf42bb](https://github.com/witchesofthehill/manabrew/commit/ecf42bb380d723f2d7282b701000ad40835b34e7))
- **ui:** rework deck editor into single-scroll moxfield-style page ([#161](https://github.com/witchesofthehill/manabrew/issues/161)) ([6bdb221](https://github.com/witchesofthehill/manabrew/commit/6bdb221e6f2028ecb046d906962b8d33e65cc21f))
- **ui:** sidebar website link + clearer engine choice in room creation ([#169](https://github.com/witchesofthehill/manabrew/issues/169)) ([fa08f36](https://github.com/witchesofthehill/manabrew/commit/fa08f36f75ab4ead04ca0047ebce71836c8ceada))
- **ui:** unified single-canvas board with 4-player table seating ([#195](https://github.com/witchesofthehill/manabrew/issues/195)) ([597a910](https://github.com/witchesofthehill/manabrew/commit/597a910e27c31a0d21942735c4cfd19a670271f6))
- **website:** add landing page and docs site ([#167](https://github.com/witchesofthehill/manabrew/issues/167)) ([168d9de](https://github.com/witchesofthehill/manabrew/commit/168d9de4e6078eb8ed28afa6b28cf4b6af41490b))

### Fixes

- bad build from renames ([#203](https://github.com/witchesofthehill/manabrew/issues/203)) ([7eea6e9](https://github.com/witchesofthehill/manabrew/commit/7eea6e95cc9a636384663e3a620f2d568ab801a2))
- better typography ([#199](https://github.com/witchesofthehill/manabrew/issues/199)) ([58d0383](https://github.com/witchesofthehill/manabrew/commit/58d03831e7329c05cfc95398ccb715ab4caf8431))
- **ci:** match nested artifact paths when attaching release assets ([#159](https://github.com/witchesofthehill/manabrew/issues/159)) ([4a0493a](https://github.com/witchesofthehill/manabrew/commit/4a0493a86d0a81b913a3df58e34f5f7ec8e6a862))
- **engine:** mirror java hasparam and svar semantics in dsl lowering ([#153](https://github.com/witchesofthehill/manabrew/issues/153)) ([95cd8c6](https://github.com/witchesofthehill/manabrew/commit/95cd8c68c4b6bf7d4c1f08d93645d782fa104b54))
- font issues on battlegrond ([#205](https://github.com/witchesofthehill/manabrew/issues/205)) ([34572b9](https://github.com/witchesofthehill/manabrew/commit/34572b99766b76c0f5407c3dbf37742431c2dbf7))
- **harness:** adapt PlayerController impls to bumped Forge API ([#213](https://github.com/witchesofthehill/manabrew/issues/213)) ([b8f3136](https://github.com/witchesofthehill/manabrew/commit/b8f31363e3d8bcb213568b497e8c57eec3943e2d))
- **hosted:** honor optional any-target bounds ([#180](https://github.com/witchesofthehill/manabrew/issues/180)) ([26e31cb](https://github.com/witchesofthehill/manabrew/commit/26e31cbe31455585d44f54aa24b865affa634e5c))
- **hosted:** label cast options by alternative cost ([#190](https://github.com/witchesofthehill/manabrew/issues/190)) ([ab74785](https://github.com/witchesofthehill/manabrew/commit/ab74785750279744af9c09c5f6855461004c62d7))
- **hosted:** preserve java game over outcomes ([#178](https://github.com/witchesofthehill/manabrew/issues/178)) ([28fe352](https://github.com/witchesofthehill/manabrew/commit/28fe3523391790f2fe9e4a78b58fef5c5c49fa9b))
- **hosted:** preserve nonland mana source choices ([#179](https://github.com/witchesofthehill/manabrew/issues/179)) ([13e69c7](https://github.com/witchesofthehill/manabrew/commit/13e69c734b35dfaa5f4eaf04a329fed6bd265348))
- **hosted:** render card names in payment prompts ([#177](https://github.com/witchesofthehill/manabrew/issues/177)) ([6bb6dfb](https://github.com/witchesofthehill/manabrew/commit/6bb6dfb1d930c4a5ff2923b817d164c684b4c0a1))
- improved casting from hand ([#188](https://github.com/witchesofthehill/manabrew/issues/188)) ([f019f14](https://github.com/witchesofthehill/manabrew/commit/f019f147bb15ef6cc6aa61cdb2f825cc10e96bea))
- landing centering ([#176](https://github.com/witchesofthehill/manabrew/issues/176)) ([a0b7a2b](https://github.com/witchesofthehill/manabrew/commit/a0b7a2b09777c7b2ab8ff741bb9e2c4acf1158e3))
- misc harness fixes to conform more to rules ([#158](https://github.com/witchesofthehill/manabrew/issues/158)) ([0120077](https://github.com/witchesofthehill/manabrew/commit/01200778d910930e12c5f790b86b983217fd45f5))
- **misc:** improve smoothness of hand animation, fix bad room reset ([#184](https://github.com/witchesofthehill/manabrew/issues/184)) ([e508e32](https://github.com/witchesofthehill/manabrew/commit/e508e324caee7097625e3c126039174a4f315293))
- **protocol:** improved action space and protocol structure ([#197](https://github.com/witchesofthehill/manabrew/issues/197)) ([384a409](https://github.com/witchesofthehill/manabrew/commit/384a409154660cdcb0c04bbf5c18e926bd046b9e))
- **ui:** fix card scale of battlegrounds ([#187](https://github.com/witchesofthehill/manabrew/issues/187)) ([1be6b86](https://github.com/witchesofthehill/manabrew/commit/1be6b861315c54dc9762df3ea020be42dddb1cbf))
- **ui:** smooth hand hover interactions ([#165](https://github.com/witchesofthehill/manabrew/issues/165)) ([ca1f16f](https://github.com/witchesofthehill/manabrew/commit/ca1f16f69323a7b184b88290b54a605334b2a613))

### Performance

- **ui:** battlefield render + canvas performance pass ([#238](https://github.com/witchesofthehill/manabrew/issues/238)) ([bbbbfac](https://github.com/witchesofthehill/manabrew/commit/bbbbfac6d9210233306ccf84d0027c2dcdcd9506))

### Refactors

- **harness:** move protocol boundary to remove duplication ([#245](https://github.com/witchesofthehill/manabrew/issues/245)) ([96fc958](https://github.com/witchesofthehill/manabrew/commit/96fc958ccb19f5c96dce48718e709bfc2e7ac975))
- **ui:** prompt file structure and interface ([#209](https://github.com/witchesofthehill/manabrew/issues/209)) ([6824fa0](https://github.com/witchesofthehill/manabrew/commit/6824fa049317cb6a079c73ec7f4ea3fe8057134b))

### Reverts

- **ui:** roll back perf pass ([#238](https://github.com/witchesofthehill/manabrew/issues/238)), keep hand-preview + ring fixes ([#241](https://github.com/witchesofthehill/manabrew/issues/241)) ([1492368](https://github.com/witchesofthehill/manabrew/commit/1492368abcbbeddf66156dadeb78133b40acfa4d))

## [0.3.0](https://github.com/witchesofthehill/manabrew/compare/v0.2.0...v0.3.0) (2026-06-11)

### Features

- **ai:** Forge's native AI in hosted play — 1v1 seat + multiplayer pods ([#139](https://github.com/witchesofthehill/manabrew/issues/139)) ([5e3ee15](https://github.com/witchesofthehill/manabrew/commit/5e3ee15e374dcf2be818295567c126dc03b9bb15))
- **companion:** focus mode, bar restructure, mobile polish ([#116](https://github.com/witchesofthehill/manabrew/issues/116)) ([546ca60](https://github.com/witchesofthehill/manabrew/commit/546ca604d49c7fc734d47a15d13596def7741192))
- **companion:** multi-touch, LifeTap layouts, commander-damage modal ([#122](https://github.com/witchesofthehill/manabrew/issues/122)) ([df6db65](https://github.com/witchesofthehill/manabrew/commit/df6db65daacad28a532e3b759160a51e82de2a44))
- **companion:** paper-play life tracker with layouts, drag-rotate-scale, themed icons ([#111](https://github.com/witchesofthehill/manabrew/issues/111)) ([2bd1238](https://github.com/witchesofthehill/manabrew/commit/2bd12389b446ccabab77fc29be22d114575bd8b1))
- **companion:** tracker v2 — turn flow, ring/speed/day-night, mana pool, log, archive, more ([#113](https://github.com/witchesofthehill/manabrew/issues/113)) ([53518c8](https://github.com/witchesofthehill/manabrew/commit/53518c82f8a209e304eb087e7cdd2205eb9a49f1))
- Join player, clear room mode init, and correct reset ([#150](https://github.com/witchesofthehill/manabrew/issues/150)) ([61a0a3f](https://github.com/witchesofthehill/manabrew/commit/61a0a3fb87943ffba8b9de0954d04671be1fd293))
- lobby improvements and self-hosting protocol ([#142](https://github.com/witchesofthehill/manabrew/issues/142)) ([db1e849](https://github.com/witchesofthehill/manabrew/commit/db1e8495c6f8a177b766103415dc23930aec069a))
- **lobby:** change player count and let any player add bots ([#131](https://github.com/witchesofthehill/manabrew/issues/131)) ([a6100c2](https://github.com/witchesofthehill/manabrew/commit/a6100c23cc63f600a7bbe3ace3947c9b03639553))
- reconnect to in-game lobby ([#156](https://github.com/witchesofthehill/manabrew/issues/156)) ([d898556](https://github.com/witchesofthehill/manabrew/commit/d8985568cd53f5b61558644ecead15100e4dcd83))
- **ui:** commander combo highlighting and bracket estimation ([#140](https://github.com/witchesofthehill/manabrew/issues/140)) ([6fdbab5](https://github.com/witchesofthehill/manabrew/commit/6fdbab5bda4bb8dea59fab164da32f541baf06ff))

### Fixes

- **build:** bundle editions/blockdata in web cardset archive ([#123](https://github.com/witchesofthehill/manabrew/issues/123)) ([a962d4b](https://github.com/witchesofthehill/manabrew/commit/a962d4bced7fc2a57d8fc51c1b1b73dccb0c63ab))
- **ci:** bad secret overwrite ([#145](https://github.com/witchesofthehill/manabrew/issues/145)) ([6b79158](https://github.com/witchesofthehill/manabrew/commit/6b791588c2a59f3f3eac18b0fba3ebfb616acf78))
- **ci:** open PR for release-as bump instead of pushing to main ([#110](https://github.com/witchesofthehill/manabrew/issues/110)) ([14757fa](https://github.com/witchesofthehill/manabrew/commit/14757fab031570a1acb92c6786da236a8d59091f))
- **ci:** reload caddy when caddyfile changes during deploy ([#155](https://github.com/witchesofthehill/manabrew/issues/155)) ([5c0f9b5](https://github.com/witchesofthehill/manabrew/commit/5c0f9b55aeeb4c0a02c6b96b3267e28414fd0df3))
- **companion:** lock page scroll and harden responsiveness ([#117](https://github.com/witchesofthehill/manabrew/issues/117)) ([be3a798](https://github.com/witchesofthehill/manabrew/commit/be3a7988da22109e016290d03d81ea0c347cdcb4))
- compose and remove local compose ([#147](https://github.com/witchesofthehill/manabrew/issues/147)) ([dd783ef](https://github.com/witchesofthehill/manabrew/commit/dd783ef5caf45a8e2f39cc4ce358883634172de0))
- **harness:** convoke delve, and some alt payment issues ([#143](https://github.com/witchesofthehill/manabrew/issues/143)) ([f6385f8](https://github.com/witchesofthehill/manabrew/commit/f6385f8a9c3f314446c9c304e7d518af120e58f8))
- **harness:** java engine handler incompleteness ([#112](https://github.com/witchesofthehill/manabrew/issues/112)) ([93421d6](https://github.com/witchesofthehill/manabrew/commit/93421d6e3caaa3d45a1fd619c17fdf090a6112f8))
- **java-harness:** misc java issues ([#119](https://github.com/witchesofthehill/manabrew/issues/119)) ([9dc3e31](https://github.com/witchesofthehill/manabrew/commit/9dc3e3111adc4bac31887f89cead59bb2190598e))
- **node:** always emit game-over prompt, even if final snapshot fails ([#141](https://github.com/witchesofthehill/manabrew/issues/141)) ([8ce0215](https://github.com/witchesofthehill/manabrew/commit/8ce0215199d98df92e3cd069bc2f8d395581c9dc))
- **node:** any not being parsed, put any as default ([#144](https://github.com/witchesofthehill/manabrew/issues/144)) ([c161a79](https://github.com/witchesofthehill/manabrew/commit/c161a792dcafdf3190f53a77dd2205ad6a468ed4))
- **node:** emit game-over prompt from hosted java sessions ([#127](https://github.com/witchesofthehill/manabrew/issues/127)) ([6342152](https://github.com/witchesofthehill/manabrew/commit/6342152175189022e61b2a0852b07b5f8b3eb5bb))
- payment session rollback and untap ([#136](https://github.com/witchesofthehill/manabrew/issues/136)) ([6a75cbe](https://github.com/witchesofthehill/manabrew/commit/6a75cbe2a2b3b6b6ffd6feab6315bb4ef79c3b62))
- protocol state update being deferred ([#130](https://github.com/witchesofthehill/manabrew/issues/130)) ([460e3bd](https://github.com/witchesofthehill/manabrew/commit/460e3bd498e4faa882ab0b5a9a3491dee1ada4ba))
- **ui:** deck editor save & exit flow bugs ([#108](https://github.com/witchesofthehill/manabrew/issues/108)) ([585327b](https://github.com/witchesofthehill/manabrew/commit/585327bdcf2d20b9126adabda4552d250412ad85))
- **ui:** mobile lobby view ([#146](https://github.com/witchesofthehill/manabrew/issues/146)) ([c4fd04d](https://github.com/witchesofthehill/manabrew/commit/c4fd04d8f99e5d16c2a3a44f90e4fddba57b93ab))
- **web:** proxy commander spellbook api to bypass cors allowlist ([#151](https://github.com/witchesofthehill/manabrew/issues/151)) ([743d5ba](https://github.com/witchesofthehill/manabrew/commit/743d5ba42086c819b489e3c49ffa93d93ab149d8))
- **web:** strip x-forwarded-host on spellbook proxy to avoid django 400 ([#154](https://github.com/witchesofthehill/manabrew/issues/154)) ([7b879d7](https://github.com/witchesofthehill/manabrew/commit/7b879d7e5a502525154a4545dac35141b98933da))

### Refactors

- decouple relay from engine + only redeploy manabrew-server when its code changes ([#149](https://github.com/witchesofthehill/manabrew/issues/149)) ([9c3b46e](https://github.com/witchesofthehill/manabrew/commit/9c3b46ee5733ae4a7449ba815cc2b5086ca41b15))
- prompt typing system ([#125](https://github.com/witchesofthehill/manabrew/issues/125)) ([72c77f6](https://github.com/witchesofthehill/manabrew/commit/72c77f640d6ed90658620fb9a08848a217e9ea5f))

## [0.2.0](https://github.com/witchesofthehill/manabrew/compare/v0.1.0...v0.2.0) (2026-06-01)

### Fixes

- **ci:** keep windows build green when discord rejects embed ([#103](https://github.com/witchesofthehill/manabrew/issues/103)) ([9962ca4](https://github.com/witchesofthehill/manabrew/commit/9962ca4760a70b36ac2e72dcced8fdcdb2a51598))
- **ci:** send discord payload via file to preserve utf-8 on windows ([#105](https://github.com/witchesofthehill/manabrew/issues/105)) ([7b07604](https://github.com/witchesofthehill/manabrew/commit/7b07604b6f71ae8782b37aad095f6f3ea6c7aab8))
- **ui:** keep limited lobby styling after StartGame flips room format ([#107](https://github.com/witchesofthehill/manabrew/issues/107)) ([36e4f68](https://github.com/witchesofthehill/manabrew/commit/36e4f681cb873c202595d04873eb7253d795fbda))

### Refactors

- **ui:** drop redundant TOP badge from stack display ([#106](https://github.com/witchesofthehill/manabrew/issues/106)) ([17ee5e7](https://github.com/witchesofthehill/manabrew/commit/17ee5e75f04f35aae91d04d43a3f56ffb6cdd33a))

## 0.1.0 (2026-06-01)

### Features

- add forge card script debugger and lsp tooling ([#480](https://github.com/witchesofthehill/manabrew/issues/480)) ([3a45501](https://github.com/witchesofthehill/manabrew/commit/3a45501dc05e6ce5ab62b3868f34544087e8fd2b))
- Add parity repair agent v0.2 ([#255](https://github.com/witchesofthehill/manabrew/issues/255)) ([d2fe522](https://github.com/witchesofthehill/manabrew/commit/d2fe522d3b08d3f0c7f25180b4ad6d120a12c251))
- **agent:** Auto-add regression test for validated fixes ([be0faf6](https://github.com/witchesofthehill/manabrew/commit/be0faf6bae01413862b847889aaabd0e30fc9637))
- Assign combat damage ([#297](https://github.com/witchesofthehill/manabrew/issues/297)) ([280f9b4](https://github.com/witchesofthehill/manabrew/commit/280f9b4dd4a04cc9f4547a51e82fd2b0f99baa05))
- **ci:** per-PR preview deploys with isolated relay (reopen of [#20](https://github.com/witchesofthehill/manabrew/issues/20)) ([#26](https://github.com/witchesofthehill/manabrew/issues/26)) ([bd800d0](https://github.com/witchesofthehill/manabrew/commit/bd800d0d26b8e0c78a127984f070bcdf2116051c))
- complete effect & replacement port + parity fixes ([#317](https://github.com/witchesofthehill/manabrew/issues/317)) ([1dafc94](https://github.com/witchesofthehill/manabrew/commit/1dafc94f6aece32793b70a11aeaa14575ae80919))
- **dashboard:** Show resolution status on failure clusters ([74ae9fa](https://github.com/witchesofthehill/manabrew/commit/74ae9fa9fb0cbc4a708cb6522eb6a2e07dcc71df))
- **debugger:** action-space surfacing + card_widgets refactor + valid_filter fix ([#518](https://github.com/witchesofthehill/manabrew/issues/518)) ([a369613](https://github.com/witchesofthehill/manabrew/commit/a369613f517fb1b37d6e6ab0b727ab3ecba82b4c))
- **deck-editor:** multi-select, lasso, labels color picker, and stack view fixes ([#293](https://github.com/witchesofthehill/manabrew/issues/293)) ([eaa2042](https://github.com/witchesofthehill/manabrew/commit/eaa204256909a45968d9c4309c3a5825cd01a496))
- **deploy:** build and deploy both manabrew-server and parity-dashboard ([a68c451](https://github.com/witchesofthehill/manabrew/commit/a68c4519f99c1566d103111a51b27de52130f8cc))
- **deploy:** Discord-friendly summary on stdout, raw log to file ([38075ff](https://github.com/witchesofthehill/manabrew/commit/38075ff82c2374f8325433133afd90d6f8eaaa9d))
- **deploy:** joyful Discord embed + rename to Wasm deploy ([#14](https://github.com/witchesofthehill/manabrew/issues/14)) ([011c8bd](https://github.com/witchesofthehill/manabrew/commit/011c8bd7692f0fef4520f42239dc952c425e2e62))
- dice rolls — engine prompts, polyhedral UI, opening d20 ([#477](https://github.com/witchesofthehill/manabrew/issues/477)) ([718a111](https://github.com/witchesofthehill/manabrew/commit/718a111a7bfc3f13e75de205b5337e55283f88a8))
- **editor:** warn on cards the engine doesn't implement ([#100](https://github.com/witchesofthehill/manabrew/issues/100)) ([7e9f843](https://github.com/witchesofthehill/manabrew/commit/7e9f843cd9e1430ded25da06eee752bd2a0d11c2))
- **engine | UI:** Commander mode ([#338](https://github.com/witchesofthehill/manabrew/issues/338)) ([b7e797e](https://github.com/witchesofthehill/manabrew/commit/b7e797e523000d2a48d2604b2cb59fa4d689e271))
- **engine:** [#152](https://github.com/witchesofthehill/manabrew/issues/152) Staticability ([#283](https://github.com/witchesofthehill/manabrew/issues/283)) ([ace74e6](https://github.com/witchesofthehill/manabrew/commit/ace74e6b601b4af38c3c5b87e6ff9d67db8c73f4))
- **engine+ui:** interactive attack cost payment for Propaganda/Ghostly Prison ([#141](https://github.com/witchesofthehill/manabrew/issues/141)) ([4769400](https://github.com/witchesofthehill/manabrew/commit/47694008a53e36868972b71b711f4f318fa21361))
- **engine:** Charm & Modal Mechanics — SP$ Charm effect (issue [#18](https://github.com/witchesofthehill/manabrew/issues/18)) ([#41](https://github.com/witchesofthehill/manabrew/issues/41)) ([6e4a0e9](https://github.com/witchesofthehill/manabrew/commit/6e4a0e98217d3b00e812727ec6295df4b196e685))
- **engine:** combat attack restrictions, requirements, and damage assignment order ([#140](https://github.com/witchesofthehill/manabrew/issues/140)) ([4bd2e63](https://github.com/witchesofthehill/manabrew/commit/4bd2e63cc14d5e883b3bdbe3010e02fe24128737))
- **engine:** Combat module ([#321](https://github.com/witchesofthehill/manabrew/issues/321)) ([9d6a5fc](https://github.com/witchesofthehill/manabrew/commit/9d6a5fc4129937a1c9bb938f0519ff721d2023ad))
- **engine:** expand cost system — 13 new cost types ([#96](https://github.com/witchesofthehill/manabrew/issues/96)) ([f6a1380](https://github.com/witchesofthehill/manabrew/commit/f6a13803e05bb6707c96e1d64d7b23bb7c8b5df6))
- **engine:** Expand trigger types from 8 to 25 (issue [#19](https://github.com/witchesofthehill/manabrew/issues/19)) ([#43](https://github.com/witchesofthehill/manabrew/issues/43)) ([ed32f9b](https://github.com/witchesofthehill/manabrew/commit/ed32f9bc7fc76f512e9f0eb52ec5c853bbc3c57f))
- **engine:** Implement 7 critical effects (issue [#52](https://github.com/witchesofthehill/manabrew/issues/52)) ([#65](https://github.com/witchesofthehill/manabrew/issues/65)) ([54429b6](https://github.com/witchesofthehill/manabrew/commit/54429b666333c33365532f3f78546cb0235b25f3))
- **engine:** Implement Fireblast, Plot, Madness, GenericChoice for realMonoRedMadness parity ([#282](https://github.com/witchesofthehill/manabrew/issues/282)) ([044d111](https://github.com/witchesofthehill/manabrew/commit/044d1110611f661bb5935a6f43a35136ebba2dc8))
- **engine:** implement next batch of keywords ([#60](https://github.com/witchesofthehill/manabrew/issues/60)) ([#244](https://github.com/witchesofthehill/manabrew/issues/244)) ([c1d585e](https://github.com/witchesofthehill/manabrew/commit/c1d585e9d0737e9490451a76c4d662e80e021200))
- **engine:** Mass & board-wide effects (issue [#17](https://github.com/witchesofthehill/manabrew/issues/17)) ([#40](https://github.com/witchesofthehill/manabrew/issues/40)) ([63d9735](https://github.com/witchesofthehill/manabrew/commit/63d9735085e37b74c037680704539609a2feb374))
- **engine:** Morph/Megamorph face-down casting and TurnFaceUp triggers ([#257](https://github.com/witchesofthehill/manabrew/issues/257)) ([94c5d76](https://github.com/witchesofthehill/manabrew/commit/94c5d76f86c16f991b1a2769ab6f33ba67c8c8ef))
- **engine:** Player & game-state effects (issue [#22](https://github.com/witchesofthehill/manabrew/issues/22)) ([#49](https://github.com/witchesofthehill/manabrew/issues/49)) ([7e2f45d](https://github.com/witchesofthehill/manabrew/commit/7e2f45d29ebf08d450d18684488bb2afb7275f2d))
- **engine:** port card module ([#326](https://github.com/witchesofthehill/manabrew/issues/326)) ([0b10d82](https://github.com/witchesofthehill/manabrew/commit/0b10d82aa4891c880c9c15b3e880118791734680))
- **engine:** Port cost module ([#336](https://github.com/witchesofthehill/manabrew/issues/336)) ([e87d2cd](https://github.com/witchesofthehill/manabrew/commit/e87d2cd84cc22277df42668995c1308953ca3949))
- **engine:** Port Java replacement/ folder to Rust ([#289](https://github.com/witchesofthehill/manabrew/issues/289)) ([39ae226](https://github.com/witchesofthehill/manabrew/commit/39ae226a27c38a5fbc146eb930a58a3e43424d2e))
- **engine:** Port player module ([#337](https://github.com/witchesofthehill/manabrew/issues/337)) ([39c456f](https://github.com/witchesofthehill/manabrew/commit/39c456f4658e0f9148c2c2a928390165273387d9))
- **engine:** port staticability full module ([#323](https://github.com/witchesofthehill/manabrew/issues/323)) ([fc0a78d](https://github.com/witchesofthehill/manabrew/commit/fc0a78d9f866f0dd8fc8fcfdfb2b6cd86af6c311))
- **engine:** port trigger module ([#333](https://github.com/witchesofthehill/manabrew/issues/333)) ([d86d8ec](https://github.com/witchesofthehill/manabrew/commit/d86d8eca084ef03b360821ac5f713aa374f57587))
- **engine:** Static abilities & CR 613 layer system ([#11](https://github.com/witchesofthehill/manabrew/issues/11)) ([#26](https://github.com/witchesofthehill/manabrew/issues/26)) ([230fb18](https://github.com/witchesofthehill/manabrew/commit/230fb182af9994e17898239043fa484805560109))
- **engine:** undo mana abilities ([#484](https://github.com/witchesofthehill/manabrew/issues/484)) ([c27256f](https://github.com/witchesofthehill/manabrew/commit/c27256fbb28cbf6757d9c88df944338b0ae18337))
- **engine:** X mana cost support and Phyrexian life payment ([#113](https://github.com/witchesofthehill/manabrew/issues/113)) ([8d70157](https://github.com/witchesofthehill/manabrew/commit/8d7015778c51c5f8274239b36c21221a6132dbc5))
- implement graveyard interaction UI for cards like Raise Dead ([b3252b1](https://github.com/witchesofthehill/manabrew/commit/b3252b14f6b354cb03b6a934fe32ff5b083e8bec))
- implement library manipulation effects (issue [#15](https://github.com/witchesofthehill/manabrew/issues/15)) ([a864c95](https://github.com/witchesofthehill/manabrew/commit/a864c9568925b4260f120c4ca9538090f0b33497))
- implement smart prio for java engine ([#97](https://github.com/witchesofthehill/manabrew/issues/97)) ([d7c0a63](https://github.com/witchesofthehill/manabrew/commit/d7c0a63ecf348579921b63dc11ea202bd838834d))
- Library Manipulation effects — Scry, Surveil, Mill, Dig (issue [#15](https://github.com/witchesofthehill/manabrew/issues/15)) ([0f53fdc](https://github.com/witchesofthehill/manabrew/commit/0f53fdc8bcf8a7dee497ea2d32f5b3c197896ba3))
- Library Manipulation effects — Scry, Surveil, Mill, Dig (issue [#15](https://github.com/witchesofthehill/manabrew/issues/15)) ([#36](https://github.com/witchesofthehill/manabrew/issues/36)) ([f54dae0](https://github.com/witchesofthehill/manabrew/commit/f54dae0a55746a0b3fce5892bca52dd10919d737))
- **limited:** .gamemodes.limited (sealed → draft → winston → gauntlet) ([#491](https://github.com/witchesofthehill/manabrew/issues/491)) ([e37ead4](https://github.com/witchesofthehill/manabrew/commit/e37ead4109f3f95898e38d2d8acc1e91800f034d))
- **limited:** multiplayer booster draft (+ image hydration / DraftCardDto cleanup) ([#80](https://github.com/witchesofthehill/manabrew/issues/80)) ([c144dda](https://github.com/witchesofthehill/manabrew/commit/c144ddada1cd5c3ee094550ea87436f52dd1db5a))
- Mono Red Madness parity + UI improvements ([#286](https://github.com/witchesofthehill/manabrew/issues/286)) ([cbb716e](https://github.com/witchesofthehill/manabrew/commit/cbb716e086773a61f8c226c36c9d54676f4cf744))
- **mulligan:** fan out prompts per round for parallel multiplayer ([#411](https://github.com/witchesofthehill/manabrew/issues/411)) ([936f604](https://github.com/witchesofthehill/manabrew/commit/936f604b3086285940955e2c4188e2ee94686bff))
- Multi-ability land tapping with picker modal and Combo mana ([#67](https://github.com/witchesofthehill/manabrew/issues/67)) ([de13430](https://github.com/witchesofthehill/manabrew/commit/de1343060973c09ebf7e85c955aa607b29abfbd7))
- **node:** hosted java-forge play-vs-ai — espresso concurrency, lobby, engine select ([#82](https://github.com/witchesofthehill/manabrew/issues/82)) ([a1ea74c](https://github.com/witchesofthehill/manabrew/commit/a1ea74cf88c6d9b57202179dd9afd2577dc45574))
- **node:** self-play soak harness (java + rust) for the hosted prompt path ([#32](https://github.com/witchesofthehill/manabrew/issues/32)) ([11af526](https://github.com/witchesofthehill/manabrew/commit/11af5265ad99a99cea3197f5a46db2ca6507b4f5))
- **parity | engine:** Make parity engine pure actions pace rng ([#242](https://github.com/witchesofthehill/manabrew/issues/242)) ([795d7ca](https://github.com/witchesofthehill/manabrew/commit/795d7cae71231a996cc8c59150098ecb0b40c1b2))
- **parity | engine:** Remove AI Controller from parity. Fix misc engine issues ([#246](https://github.com/witchesofthehill/manabrew/issues/246)) ([c11b538](https://github.com/witchesofthehill/manabrew/commit/c11b538dff942d2f272276f9a2eb5e1964151ac2))
- **parity:** Add --java-workers ([#340](https://github.com/witchesofthehill/manabrew/issues/340)) ([bfa3e60](https://github.com/witchesofthehill/manabrew/commit/bfa3e6008d90c5c463dbca217ade02674c12a852))
- **parity:** Add `since` filter to failures and clusters API endpoints ([ad2e9cc](https://github.com/witchesofthehill/manabrew/commit/ad2e9cce697aec1bc28ea328267797c94bd96490))
- **parity:** add analysis daemon with LLM, Discord, and GitHub integration ([#155](https://github.com/witchesofthehill/manabrew/issues/155)) ([5ca5de8](https://github.com/witchesofthehill/manabrew/commit/5ca5de8e7175b92967d1f40c7b4d869d67822ed1))
- **parity:** Add cluster/analysis to failures and hover tooltips to matrix ([cb70a0a](https://github.com/witchesofthehill/manabrew/commit/cb70a0aa4200b20e9e3510d525b16a26d797b6a6))
- **parity:** Add Commander variant support to parity engine ([#341](https://github.com/witchesofthehill/manabrew/issues/341)) ([ac87518](https://github.com/witchesofthehill/manabrew/commit/ac8751806e0de101687cfb9b0624d07b327984e9))
- **parity:** Add field filter to failures API endpoint ([5da2af2](https://github.com/witchesofthehill/manabrew/commit/5da2af2e0716f5bd1c44729b47e30de44410fb16))
- **parity:** add Java harness server mode to eliminate per-matchup JVM startup ([#88](https://github.com/witchesofthehill/manabrew/issues/88)) ([47ce58f](https://github.com/witchesofthehill/manabrew/commit/47ce58f6022efc9f654f2060e354b7f3aa05b5f0))
- **parity:** Add time range filtering, commit tracking, and run-matchup API ([f3d9f14](https://github.com/witchesofthehill/manabrew/commit/f3d9f146e16267e2ccb0861d9b51ba58c25c86f4))
- **parity:** agentic tool-calling analyzer ([#157](https://github.com/witchesofthehill/manabrew/issues/157)) ([45272af](https://github.com/witchesofthehill/manabrew/commit/45272af8b7343769361710a87c8013c453e2dbb9))
- **parity:** backfill GitHub issues for existing clusters on startup ([5e63aa7](https://github.com/witchesofthehill/manabrew/commit/5e63aa75b75602f1d57bda6cc98b269cbf0a4a22))
- **parity:** Blacklist real\_ decks from scheduling and stats ([b21ef61](https://github.com/witchesofthehill/manabrew/commit/b21ef61d697bc1432edbcc479664edc478b097da))
- **parity:** CI server mode with persistent JVM and job queue API ([#171](https://github.com/witchesofthehill/manabrew/issues/171)) ([add2aef](https://github.com/witchesofthehill/manabrew/commit/add2aef3be0f202eb24a0d4ef8ed03bace711d81))
- **parity:** continuous parity server with SQLite and web dashboard ([#149](https://github.com/witchesofthehill/manabrew/issues/149)) ([9ffd228](https://github.com/witchesofthehill/manabrew/commit/9ffd22829bfe9b3af9a56dafeb840ec75a08449c))
- **parity:** Docker layer caching + n8n auto-deploy ([#167](https://github.com/witchesofthehill/manabrew/issues/167)) ([c24edd8](https://github.com/witchesofthehill/manabrew/commit/c24edd8b9f28bbfc5168bcda2363f4388bf6e89d))
- **parity:** parity crate + Java forge-harness for cross-engine differential testing ([#51](https://github.com/witchesofthehill/manabrew/issues/51)) ([ae0beec](https://github.com/witchesofthehill/manabrew/commit/ae0beecae22aa1ca49c120ba2d2509db692f907b))
- **parity:** fuzz random deck testing with dynamic card pool ([#85](https://github.com/witchesofthehill/manabrew/issues/85)) ([548c0d5](https://github.com/witchesofthehill/manabrew/commit/548c0d5b75b59da860694e2cafc6a4467b2e73dd))
- **parity:** Introduce extra actions ([#115](https://github.com/witchesofthehill/manabrew/issues/115)) ([3fa5dc2](https://github.com/witchesofthehill/manabrew/commit/3fa5dc2766045e914f3a1b6ff4f3a8624aba55cd))
- **parity:** Java harness server mode + fuzz pool effect filter ([#91](https://github.com/witchesofthehill/manabrew/issues/91)) ([ba8b7a3](https://github.com/witchesofthehill/manabrew/commit/ba8b7a3fa81779aec237c01ad505cf80d5740e02))
- **parity:** Java output cache — skip redundant JVM spawns ([#264](https://github.com/witchesofthehill/manabrew/issues/264)) ([d9d73ef](https://github.com/witchesofthehill/manabrew/commit/d9d73efeea527392e3755d872e72f50109a63b46))
- **parity:** multi-deck matrix mode with rayon parallelization ([#70](https://github.com/witchesofthehill/manabrew/issues/70)) ([213be79](https://github.com/witchesofthehill/manabrew/commit/213be794eaa74e1b55e7db8272d1ea62dbdde290))
- **parity:** normalize field indices for GitHub issue dedup ([5bed28a](https://github.com/witchesofthehill/manabrew/commit/5bed28a9cbba03123e1c7a738f812e796babdf34))
- **parity:** normalize field indices in dashboard clusters API ([3a8272e](https://github.com/witchesofthehill/manabrew/commit/3a8272eeb2f21dc0d424a81af9ecc673154b9934))
- **parity:** randomize agent decisions with deterministic seed ([#83](https://github.com/witchesofthehill/manabrew/issues/83)) ([97fafac](https://github.com/witchesofthehill/manabrew/commit/97fafac27efd6e9b7610f30074c85575b6a49943))
- **parity:** replace gh CLI with reqwest GitHub REST API ([51dff87](https://github.com/witchesofthehill/manabrew/commit/51dff873ce363df8b46a99033c0522af36cc5f14))
- **parity:** reqwest GitHub API + dedup issue creation ([1360c28](https://github.com/witchesofthehill/manabrew/commit/1360c28b603de725e26adde92bbb74669e5a6147))
- **parity:** separate fuzz data from preset data ([#161](https://github.com/witchesofthehill/manabrew/issues/161)) ([2f556ec](https://github.com/witchesofthehill/manabrew/commit/2f556ecab9e6b72256354e344f99814ea4dcf914))
- **parity:** split parity decks + non-interactive import + 31 starter decks ([#534](https://github.com/witchesofthehill/manabrew/issues/534)) ([a5515f6](https://github.com/witchesofthehill/manabrew/commit/a5515f62c9fe7ea2ed5f782803729d825dcf428a))
- **parity:** support custom OpenAI-compatible endpoints (LiteLLM) ([b0666d9](https://github.com/witchesofthehill/manabrew/commit/b0666d957c85a81b360462760030e3442c1979df))
- **parity:** Time-filter headline stats and inline traces in failures tab ([1f52c9b](https://github.com/witchesofthehill/manabrew/commit/1f52c9bd5302e6db40cc4876e9fe70525b3fbc8e))
- **pixi:** grid-based battlefield with stacking, center-placement, and settings ([#404](https://github.com/witchesofthehill/manabrew/issues/404)) ([4b559c8](https://github.com/witchesofthehill/manabrew/commit/4b559c86f40b322932e0137cbe5521ef7bf85c87))
- port ability module — 100% scan coverage ([#301](https://github.com/witchesofthehill/manabrew/issues/301)) ([#322](https://github.com/witchesofthehill/manabrew/issues/322)) ([24fc95d](https://github.com/witchesofthehill/manabrew/commit/24fc95d3fd36eeb4567d8160f555bc429a33ef3c))
- port keyword module — 100% scan coverage ([#304](https://github.com/witchesofthehill/manabrew/issues/304)) ([#320](https://github.com/witchesofthehill/manabrew/issues/320)) ([ca41d56](https://github.com/witchesofthehill/manabrew/commit/ca41d56e2ae74e83951a2f89eb00a3932e4c2696))
- port mana module — 100% scan coverage (5/5 files, 46/46 symbols) ([#305](https://github.com/witchesofthehill/manabrew/issues/305)) ([#328](https://github.com/witchesofthehill/manabrew/issues/328)) ([3d46a76](https://github.com/witchesofthehill/manabrew/commit/3d46a76847f346542cd4a34bb3f9de316601fff3))
- port phase module — 100% scan coverage (6/6 files, 35/35 symbols) ([#307](https://github.com/witchesofthehill/manabrew/issues/307)) ([#324](https://github.com/witchesofthehill/manabrew/issues/324)) ([8895a65](https://github.com/witchesofthehill/manabrew/commit/8895a65f0d59e9409d429b6cbe9c2ef9c72787a6))
- port replacement module — 100% scan coverage (45/45 files, 57/57 symbols) ([#310](https://github.com/witchesofthehill/manabrew/issues/310)) ([#335](https://github.com/witchesofthehill/manabrew/issues/335)) ([fad1212](https://github.com/witchesofthehill/manabrew/commit/fad1212a382b3b83c38ed7d156f5cfbec6d330ca))
- port spellability module — 100% scan coverage (22/22 files, 133/133 symbols) ([#311](https://github.com/witchesofthehill/manabrew/issues/311)) ([#327](https://github.com/witchesofthehill/manabrew/issues/327)) ([2c46936](https://github.com/witchesofthehill/manabrew/commit/2c469366dd7efab75e62cef673ffa54769b82a6f))
- port zone module — 100% scan coverage (7/7 files, 53/53 symbols) ([#314](https://github.com/witchesofthehill/manabrew/issues/314)) ([#325](https://github.com/witchesofthehill/manabrew/issues/325)) ([43e4842](https://github.com/witchesofthehill/manabrew/commit/43e484207b0422d623c8accb1d815e6be9f2c278))
- **replacement:** expand replacement effects ([#56](https://github.com/witchesofthehill/manabrew/issues/56)) ([c7ba30a](https://github.com/witchesofthehill/manabrew/commit/c7ba30a0ddda513ea84549beba40807c37c8c9cf))
- **replacement:** expand replacement effects with 6 new event types ([#56](https://github.com/witchesofthehill/manabrew/issues/56)) ([6205a9a](https://github.com/witchesofthehill/manabrew/commit/6205a9afff3de78f6b6f44415788ee98e00cd73e))
- Scan features ([#300](https://github.com/witchesofthehill/manabrew/issues/300)) ([5f6ce8a](https://github.com/witchesofthehill/manabrew/commit/5f6ce8ab3d1c709a1ee134a6673c74767daf9720))
- standalone card search page & card detail modal ([#290](https://github.com/witchesofthehill/manabrew/issues/290)) ([20ca560](https://github.com/witchesofthehill/manabrew/commit/20ca560fdd99a66590bc20f6b42a4361b4c4ecb2))
- **tools:** add deck importer CLI ([#387](https://github.com/witchesofthehill/manabrew/issues/387)) ([3c8b385](https://github.com/witchesofthehill/manabrew/commit/3c8b38561766ad0fd9fac78c318b79d5622bbc44))
- **triggers:** expand trigger types, fire points, and code quality ([#54](https://github.com/witchesofthehill/manabrew/issues/54)) ([#84](https://github.com/witchesofthehill/manabrew/issues/84)) ([265be72](https://github.com/witchesofthehill/manabrew/commit/265be727255e3a81ab17bb69a6f554355d186de6))
- **triggers:** implement 35 new trigger types ([#81](https://github.com/witchesofthehill/manabrew/issues/81)) ([01d1f61](https://github.com/witchesofthehill/manabrew/commit/01d1f6139f5bdd0967cacd6cffdca7d43691a3eb))
- **ui | engine:** Fix UI callback gaps for engine agent methods ([#248](https://github.com/witchesofthehill/manabrew/issues/248)) ([a7f47aa](https://github.com/witchesofthehill/manabrew/commit/a7f47aa9dddacd9c4327a0515b149ca49e1261aa))
- **ui | engine:** stack logs + infra ([#144](https://github.com/witchesofthehill/manabrew/issues/144)) ([4105eea](https://github.com/witchesofthehill/manabrew/commit/4105eeab64464f03b5ba99d5cbf8d0aad065af73))
- **ui:** add terms acknowledgement onboarding gate ([#540](https://github.com/witchesofthehill/manabrew/issues/540)) ([57f15a6](https://github.com/witchesofthehill/manabrew/commit/57f15a6f7e3ad5772aa08db6a564c5fcfa305a44))
- **ui:** Auto-priority pass with random delay ([#48](https://github.com/witchesofthehill/manabrew/issues/48)) ([1348a68](https://github.com/witchesofthehill/manabrew/commit/1348a6880d7a47246408c9140bf47ff707751a8a))
- **ui:** better atk prio phase handling ([#476](https://github.com/witchesofthehill/manabrew/issues/476)) ([735f5bf](https://github.com/witchesofthehill/manabrew/commit/735f5bfaf875fe941c94b50848980ddda014065e))
- **ui:** custom targeting pointers with per-intent icons and glow ([#413](https://github.com/witchesofthehill/manabrew/issues/413)) ([d97f09f](https://github.com/witchesofthehill/manabrew/commit/d97f09fe54c92c576bfe677a97420ef401f808c3))
- **ui:** Draggable stack view sections + Zustand DevTools ([#344](https://github.com/witchesofthehill/manabrew/issues/344)) ([bc57a20](https://github.com/witchesofthehill/manabrew/commit/bc57a203e6849d543b6db93addb1f28758c19248))
- **ui:** game UX overhaul — copy badge, auto-stack, combat polish, prompt auto-resolver, counter icons, dev panel ([#509](https://github.com/witchesofthehill/manabrew/issues/509)) ([4d1a078](https://github.com/witchesofthehill/manabrew/commit/4d1a078cdb5c112fd66fed09f616a454d0a8c5fc))
- **ui:** granular card actions in deck editor ([#485](https://github.com/witchesofthehill/manabrew/issues/485)) ([f14d90d](https://github.com/witchesofthehill/manabrew/commit/f14d90dc863408acea9743eff0bb3c83fa38c998))
- **ui:** in-pile counter target + clearer stack ordering ([#96](https://github.com/witchesofthehill/manabrew/issues/96)) ([2f98263](https://github.com/witchesofthehill/manabrew/commit/2f982639150dcda5a3deb306f860fa9ffab857cc))
- **ui:** preset decks browser + format-aware play selection ([#522](https://github.com/witchesofthehill/manabrew/issues/522)) ([4c4c27d](https://github.com/witchesofthehill/manabrew/commit/4c4c27d95f34fbb4270ea026c61fb247973caab8))
- **ui:** sticky card previews with grace period ([#370](https://github.com/witchesofthehill/manabrew/issues/370)) ([1b5c1df](https://github.com/witchesofthehill/manabrew/commit/1b5c1dfa3d5beac2ae92ff94f1b35b7db3135498))
- **ui:** tabletop mode uses DeckVsSelector and supports preset decks ([#473](https://github.com/witchesofthehill/manabrew/issues/473)) ([70d2cbb](https://github.com/witchesofthehill/manabrew/commit/70d2cbb0f764a1781a3b274ebc6179677698664d))
- unified archive and app init ([#541](https://github.com/witchesofthehill/manabrew/issues/541)) ([96bb5ca](https://github.com/witchesofthehill/manabrew/commit/96bb5ca50148f1bab2096f1c8197a02049856214))
- **wasm:** Full WASM web platform with interactive gameplay & multiplayer ([#351](https://github.com/witchesofthehill/manabrew/issues/351)) ([e10a0d5](https://github.com/witchesofthehill/manabrew/commit/e10a0d5b05cd6b5fffbebf74eba12355d87a5fc2))
- **web:** configure hosted forge runtime ([#25](https://github.com/witchesofthehill/manabrew/issues/25)) ([cb94dd6](https://github.com/witchesofthehill/manabrew/commit/cb94dd6b5ab547a7d5be4600be43affb04b4449c))

### Fixes

- **agent:** Add guardrails to prevent hack fixes in parity repair agent ([a0d70e4](https://github.com/witchesofthehill/manabrew/commit/a0d70e44aa92237e44312f9e07d73fcbde6a01b4))
- **agent:** Fix broken validation — add --bin flag, field-aware scoring, v0.3 ([aa57d48](https://github.com/witchesofthehill/manabrew/commit/aa57d48733c83d626bfafe8f45c95cad46eef336))
- **agent:** Increase per-attempt budget from $5 to $15 ([3b908c9](https://github.com/witchesofthehill/manabrew/commit/3b908c9299e623890a12a86e73e59ca9d9dfb79e))
- **agent:** Parity repair agent v0.3 — fix validation and git cleanup ([ea23eae](https://github.com/witchesofthehill/manabrew/commit/ea23eae323ddf044784648d1f1388e56123d0ed3))
- **agent:** Use --games 1 in auto-added regression tests ([263a38c](https://github.com/witchesofthehill/manabrew/commit/263a38c5dabb466124c867fb8280f9179e274415))
- **agent:** Use exit code for PASS/FAIL detection instead of string matching ([01cf2a6](https://github.com/witchesofthehill/manabrew/commit/01cf2a6bf02f697735df458172e2389c20c6f8c4))
- aura enchantments — SBA, AddAbility, SVar resolution, mana tracking ([a0076d0](https://github.com/witchesofthehill/manabrew/commit/a0076d0c969f957313ecf0d9645b36f5c7dfc734))
- aura targeting enforcement and playability checks ([268cd0c](https://github.com/witchesofthehill/manabrew/commit/268cd0c2084760a5b14fd54b6a099b1994eb4c1a))
- bot in room for web, misc fixes on lobby deck exchange ([#556](https://github.com/witchesofthehill/manabrew/issues/556)) ([70333be](https://github.com/witchesofthehill/manabrew/commit/70333be0c657fd4c4f042b9c3b1bb6896475ca3d))
- **ci:** prevent windows changelog step from inheriting git exit code ([#511](https://github.com/witchesofthehill/manabrew/issues/511)) ([2addc6b](https://github.com/witchesofthehill/manabrew/commit/2addc6be6ddb93bb3e631d99882d12bc6d402a19))
- **ci:** use yarn instead of npm in Dockerfile.web ([#470](https://github.com/witchesofthehill/manabrew/issues/470)) ([e8c3aaf](https://github.com/witchesofthehill/manabrew/commit/e8c3aafc8e02fd4ab345559fd677ad3c1ef4c356))
- **dashboard:** replace confusing dual-axis chart with stacked bar + line ([0b0adb8](https://github.com/witchesofthehill/manabrew/commit/0b0adb8225c793c12c041d84ec7beb7134066900))
- **deploy:** cap Maven heap at 512m and skip checkstyle to avoid OOM ([4dae286](https://github.com/witchesofthehill/manabrew/commit/4dae2868da363cd3c804d43ce5a459484a5d5ac3))
- **deploy:** copy checkstyle.xml into Docker java-builder stage ([50940c6](https://github.com/witchesofthehill/manabrew/commit/50940c66b2b31aeb582cfa0d27b77631586063ef))
- **deploy:** copy tree-sitter-forge-card-script into parity docker build ([#500](https://github.com/witchesofthehill/manabrew/issues/500)) ([fcbd345](https://github.com/witchesofthehill/manabrew/commit/fcbd345927ddde47b9bd157882fa0ccc3fe2938a))
- **deploy:** copy tree-sitter-forge-card-script into web docker build ([#488](https://github.com/witchesofthehill/manabrew/issues/488)) ([b9da708](https://github.com/witchesofthehill/manabrew/commit/b9da708bf5cc31f047a497c766f57730f6785ebf))
- **deploy:** force plain BuildKit progress so redirects actually work ([259a63f](https://github.com/witchesofthehill/manabrew/commit/259a63ffbf74cde0c14588567a01f7afbf79a743))
- **deploy:** init forge submodule in preview-deploy ([#64](https://github.com/witchesofthehill/manabrew/issues/64)) ([9eee16b](https://github.com/witchesofthehill/manabrew/commit/9eee16be31a0bc0b21f5c195e245cbbae4c47ff2))
- **deploy:** init forge submodule on the deploy host ([#56](https://github.com/witchesofthehill/manabrew/issues/56)) ([f9a5d80](https://github.com/witchesofthehill/manabrew/commit/f9a5d80106fb387c3baeb57375270efe9e60a877))
- **deploy:** limit container restarts to 5 to avoid infinite crash loops ([6733fd6](https://github.com/witchesofthehill/manabrew/commit/6733fd6ad0a47ba08c4e75e697a336a4b46f996c))
- **deploy:** Pass GIT_COMMIT_SHA build arg to Docker build ([b5d5eab](https://github.com/witchesofthehill/manabrew/commit/b5d5eab58a56b29054dd2c4e0fa2698b0eebbf4a))
- **deploy:** point origin remote at correct repo url ([#545](https://github.com/witchesofthehill/manabrew/issues/545)) ([8185835](https://github.com/witchesofthehill/manabrew/commit/81858352b514ce1d18052e920d56b9cf42d26cf1))
- **deploy:** print failure warning to stdout for Discord visibility ([b7ea22c](https://github.com/witchesofthehill/manabrew/commit/b7ea22cf0cba3920cf27cbbf370e370a71e31cc3))
- **deploy:** strip unused Maven modules in Dockerfile, fix deploy paths ([8f50931](https://github.com/witchesofthehill/manabrew/commit/8f50931d58786bde58b74b4a765f212cdc0e64f5))
- **deploy:** use GITHUB_TOKEN from .env for git pull (no SSH key needed) ([53c0b05](https://github.com/witchesofthehill/manabrew/commit/53c0b057d994e7ce2b2fd6e5dc12f8d5b7cc6a11))
- dice roll on game start for java room ([#98](https://github.com/witchesofthehill/manabrew/issues/98)) ([5270460](https://github.com/witchesofthehill/manabrew/commit/5270460363cee58cbc4dc9d8d5e375174db19914))
- **engine | harness:** Fix 3 parity regressions and CI permissions ([#253](https://github.com/witchesofthehill/manabrew/issues/253)) ([8070357](https://github.com/witchesofthehill/manabrew/commit/8070357ad7b0c0c4eae893713d6ab03c560e6c84))
- **engine | parity:** Fix 11 confirmed bugs across engine and harness ([#249](https://github.com/witchesofthehill/manabrew/issues/249)) ([5542517](https://github.com/witchesofthehill/manabrew/commit/554251727dba5655435b42e11682468656cbfebd))
- **engine:** Ashling commander deck + 4 parity bugs ([#385](https://github.com/witchesofthehill/manabrew/issues/385)) ([e3e2f30](https://github.com/witchesofthehill/manabrew/commit/e3e2f300575c41b724a119448001bbfc814f0443))
- **engine:** bring kaalia parity seed forward ([#514](https://github.com/witchesofthehill/manabrew/issues/514)) ([47d3715](https://github.com/witchesofthehill/manabrew/commit/47d37154839a3b1c332d4799f977fc33f464cfb5))
- **engine:** emit game-over prompt from java-hosted sessions ([#99](https://github.com/witchesofthehill/manabrew/issues/99)) ([3a418e3](https://github.com/witchesofthehill/manabrew/commit/3a418e3db9c9dc47e9b622b4fdc0395bc85f94a9))
- **engine:** Fix cost payment bugs from merge ([#270](https://github.com/witchesofthehill/manabrew/issues/270)) ([63ccf4d](https://github.com/witchesofthehill/manabrew/commit/63ccf4d5e89e339aa9984141bfb6278a391e593a))
- **engine:** fix priority on attack, fix colorless autopay, fix cards… ([#523](https://github.com/witchesofthehill/manabrew/issues/523)) ([dd2eb4a](https://github.com/witchesofthehill/manabrew/commit/dd2eb4a86887525c38181be39858c112c6b6b375))
- **engine:** fix prompts and TriggerRemember ([#525](https://github.com/witchesofthehill/manabrew/issues/525)) ([f2642f4](https://github.com/witchesofthehill/manabrew/commit/f2642f43cbdb680620b4f5655b9701a3ded007d0))
- **engine:** Fix subtype qualifier matching in valid_filter — was matching all cards ([#280](https://github.com/witchesofthehill/manabrew/issues/280)) ([8e07aa2](https://github.com/witchesofthehill/manabrew/commit/8e07aa209928f8622d6511b4c0d31f15aaa8a1f2))
- **engine:** Greedy phyrexian mana matching Java parity ([#256](https://github.com/witchesofthehill/manabrew/issues/256)) ([da0a5b7](https://github.com/witchesofthehill/manabrew/commit/da0a5b7972065325ad43208b8893086e7898c754))
- **engine:** misc fixes for sauron the dark lord ([#58](https://github.com/witchesofthehill/manabrew/issues/58)) ([ed0b803](https://github.com/witchesofthehill/manabrew/commit/ed0b803993a988dc6c428e43fc8572bf2814d3eb))
- **engine:** phased-out trigger gate + animate keyword cleanup on zone change ([#504](https://github.com/witchesofthehill/manabrew/issues/504)) ([4f7e4eb](https://github.com/witchesofthehill/manabrew/commit/4f7e4eba663a26d57bf97986388abfafd0004c49))
- **engine:** proper static ability modes modelling ([#479](https://github.com/witchesofthehill/manabrew/issues/479)) ([d21c776](https://github.com/witchesofthehill/manabrew/commit/d21c77686c6c38c5be61e799bf9f9e433daebeb6))
- **engine:** reserve additional-cost sacs from spell mana auto-pay ([b64cbec](https://github.com/witchesofthehill/manabrew/commit/b64cbec18c648b08e2c636d090330b66e0c915e5))
- **engine:** reserve additional-cost sacs from spell mana auto-pay ([f3f0aad](https://github.com/witchesofthehill/manabrew/commit/f3f0aad41b225511d5f82d1287035fbb6b89423a))
- **engine:** resolve jund parity panics and 15+ parity divergences ([#345](https://github.com/witchesofthehill/manabrew/issues/345)) ([5e3e7c3](https://github.com/witchesofthehill/manabrew/commit/5e3e7c3315a338951137c03637fbc010302bd8f6))
- **engine:** starter_animar parity — iterative seed-by-seed ([#549](https://github.com/witchesofthehill/manabrew/issues/549)) ([f6059eb](https://github.com/witchesofthehill/manabrew/commit/f6059ebb35b5a7a244049a09b68b3e7ddc186a6a))
- **engine:** World shaper seed 42 - Add action space to decision log ([#506](https://github.com/witchesofthehill/manabrew/issues/506)) ([400c3cc](https://github.com/witchesofthehill/manabrew/commit/400c3ccdb9006028ecf2f6451e2fedf883850e1d))
- **forge:** java dto zone casting ([#91](https://github.com/witchesofthehill/manabrew/issues/91)) ([8a6be25](https://github.com/witchesofthehill/manabrew/commit/8a6be25707664a46ac196e2daf2418e0926da774))
- hosted play-vs-ai — let the user set format and start, not the node ([#94](https://github.com/witchesofthehill/manabrew/issues/94)) ([f5281f4](https://github.com/witchesofthehill/manabrew/commit/f5281f45878f893ce78fd32778843432f58147aa))
- include mana abilities on interactive controller action space ([#93](https://github.com/witchesofthehill/manabrew/issues/93)) ([d113015](https://github.com/witchesofthehill/manabrew/commit/d113015cc9cf15c47fd1f756a443ad821bdbfa04))
- **infra:** build manabrew-server with full workspace context ([#555](https://github.com/witchesofthehill/manabrew/issues/555)) ([9062b18](https://github.com/witchesofthehill/manabrew/commit/9062b18ede8934e54546affe02f5ce3051bd7b3a))
- **infra:** Update deploy.sh to respect COMPOSE_PROFILES for parity dashboard ([7a1f63d](https://github.com/witchesofthehill/manabrew/commit/7a1f63d810895b26a5645dc0eecb3e889fc894be))
- java self hosted dto ([#90](https://github.com/witchesofthehill/manabrew/issues/90)) ([d11cc7e](https://github.com/witchesofthehill/manabrew/commit/d11cc7ed833409afd46b2ef226bc72436ea768db))
- **lobby:** let host set room format on enter, not just at game start ([#85](https://github.com/witchesofthehill/manabrew/issues/85)) ([070d880](https://github.com/witchesofthehill/manabrew/commit/070d880cf0f5164f42e5c44d35fff32747dfc1d9))
- **multiplayer:** broadcast game-over and unstick lobby return on concede ([#53](https://github.com/witchesofthehill/manabrew/issues/53)) ([5aeeed7](https://github.com/witchesofthehill/manabrew/commit/5aeeed7518ea00ef44d98d70eb0f94decf08da19))
- **parity:** 100% extended matrix — mana, combat, Bushido, token filter ([#142](https://github.com/witchesofthehill/manabrew/issues/142)) ([a7623c5](https://github.com/witchesofthehill/manabrew/commit/a7623c53275cfad40d8a506afce09efa61370a8f))
- **parity:** add stub lib.rs in Dockerfile for src-tauri workspace member ([26e6ac5](https://github.com/witchesofthehill/manabrew/commit/26e6ac599c6bb14d5321465788387f228984a4d2))
- **parity:** always log Java stderr for crash diagnostics ([9dcb509](https://github.com/witchesofthehill/manabrew/commit/9dcb50945bd93195d08e4acb37db40ccb65c121b))
- **parity:** ashling_limitless_commander seed 44 passes ([#439](https://github.com/witchesofthehill/manabrew/issues/439)) ([b8bd060](https://github.com/witchesofthehill/manabrew/commit/b8bd060051c389cf56d9c24d80050f9e59184a69))
- **parity:** ashling_limitless_commander seed 45 passes ([#478](https://github.com/witchesofthehill/manabrew/issues/478)) ([953fbf6](https://github.com/witchesofthehill/manabrew/commit/953fbf6378091399a6b292e6ea07087d9bd672d2))
- **parity:** binary insertion sort + deathtouch through wither ([#147](https://github.com/witchesofthehill/manabrew/issues/147)) ([c277763](https://github.com/witchesofthehill/manabrew/commit/c277763394fa1a0f4056b037182ec0b572ab2fbb))
- **parity:** Cache Java output for both passes and failures ([42c7968](https://github.com/witchesofthehill/manabrew/commit/42c7968dd915da687076bdc0c7a61c6940e59751))
- **parity:** Charm sub-ability targeting in DeterministicController ([85194f9](https://github.com/witchesofthehill/manabrew/commit/85194f937e27a25672f21ee7072d1e213abbb5c0))
- **parity:** comprehensive DeterministicController overrides ([#119](https://github.com/witchesofthehill/manabrew/issues/119)-[#126](https://github.com/witchesofthehill/manabrew/issues/126)) ([#138](https://github.com/witchesofthehill/manabrew/issues/138)) ([2489509](https://github.com/witchesofthehill/manabrew/commit/2489509d86c0996066d5a5754000ece4cc9e2783))
- **parity:** copy full forge-gui/res/ for Java Localizer ([e4bb147](https://github.com/witchesofthehill/manabrew/commit/e4bb1470d19a152efe3f44068f7ed87b3fe2a2f3))
- **parity:** counter targeting, zone search sorting, +1/+1 cancellation — 126/126 base matrix PASS ([430adb4](https://github.com/witchesofthehill/manabrew/commit/430adb42453f979cff68ae353274b5bc1743d40e))
- **parity:** DamagedBy trigger filter and explore Num loop ([d88dc46](https://github.com/witchesofthehill/manabrew/commit/d88dc46c7a12714764816c61c82a416724815d1b))
- **parity:** decouple GitHub issues from LLM analysis ([c9d4555](https://github.com/witchesofthehill/manabrew/commit/c9d45554d127cc9af569b448d233eef78c5cec8b))
- **parity:** disable GitHub issue comments to avoid spamming subscribers ([4be6c27](https://github.com/witchesofthehill/manabrew/commit/4be6c27f30f68ba98e22a38f217f96e39e62e227))
- **parity:** empty mana pools at phase transitions (MTG rule 500.4) ([6bdee6f](https://github.com/witchesofthehill/manabrew/commit/6bdee6fa10c09402d2cde2496a1925de8722bcaa))
- **parity:** Exclude blacklisted decks from all dashboard endpoints ([104cf97](https://github.com/witchesofthehill/manabrew/commit/104cf97b204d37fb5d0cafa527710ce8c023e104))
- **parity:** filter Java stderr spam, add analyzer env vars to compose ([8223c2a](https://github.com/witchesofthehill/manabrew/commit/8223c2ac99c9fffe144dd7ee333bbcaf29260000))
- **parity:** Fix commit SHA in Docker and preserve traces across refresh ([cc139e1](https://github.com/witchesofthehill/manabrew/commit/cc139e1a49348fabdc37a18cee485e174818986f))
- **parity:** Fix counterspell targeting — Java harness Card/SpellAbility type mismatch ([#262](https://github.com/witchesofthehill/manabrew/issues/262)) ([10258ae](https://github.com/witchesofthehill/manabrew/commit/10258aea19700467a031cca79c0e95db9508a73d))
- **parity:** Fix divergence in `players[*].graveyard` ([#263](https://github.com/witchesofthehill/manabrew/issues/263)) ([f2e31b2](https://github.com/witchesofthehill/manabrew/commit/f2e31b242dc2674cb75b61783d844d87c3a2344b))
- **parity:** Fix divergence in `players[*].poison` ([#261](https://github.com/witchesofthehill/manabrew/issues/261)) ([f2e1328](https://github.com/witchesofthehill/manabrew/commit/f2e13280d7b76db6b61286c809b2dfca2bd62161))
- **parity:** fix Docker cardsfolder path for Java harness auto-detect ([712514c](https://github.com/witchesofthehill/manabrew/commit/712514c456ccb44238323e69bd226b97cc5b1dab))
- **parity:** Fix exile zone divergence — Deputy of Detention, perpetual P/T, parent target propagation ([#259](https://github.com/witchesofthehill/manabrew/issues/259)) ([e5a9936](https://github.com/witchesofthehill/manabrew/commit/e5a9936812cfb8a1c1f43af33b9c11c3b13ef91a))
- **parity:** Fix matrix tooltip clipping and analysis toggle propagation ([d5cbc94](https://github.com/witchesofthehill/manabrew/commit/d5cbc946986cb858956b08d0278d7c4ba8567e8b))
- **parity:** Fix multiple RNG desync and engine bugs ([#251](https://github.com/witchesofthehill/manabrew/issues/251)) ([5a89fcc](https://github.com/witchesofthehill/manabrew/commit/5a89fccad686472cb9d7cdaf5350b38040e4cb1e))
- **parity:** Fix stats URL query param prefix for time range filter ([653a6f4](https://github.com/witchesofthehill/manabrew/commit/653a6f47455611c486cd83cf65286758c7a47746))
- **parity:** hybrid mana, haste snapshot, RNG unification — 92.9% extended ([#116](https://github.com/witchesofthehill/manabrew/issues/116)) ([1a0cffd](https://github.com/witchesofthehill/manabrew/commit/1a0cffd9488972b1f766bff9ba54ca590ef8b172))
- **parity:** mana pool, random discard, and first-strike combat fixes ([#93](https://github.com/witchesofthehill/manabrew/issues/93)) ([4a8b458](https://github.com/witchesofthehill/manabrew/commit/4a8b45886323d4979fb773aee9694d31a92bc1dd))
- **parity:** mana source ordering, charm mode filtering, and Ponder reorder ([cacdcf1](https://github.com/witchesofthehill/manabrew/commit/cacdcf17ffd6dddd29bcc0a75c48963f1efce226))
- **parity:** never pay additional costs in DeterministicController ([#129](https://github.com/witchesofthehill/manabrew/issues/129)) ([e784f32](https://github.com/witchesofthehill/manabrew/commit/e784f320e67d17a364a21667b81153e63af66853)), closes [#118](https://github.com/witchesofthehill/manabrew/issues/118)
- **parity:** pass GITHUB_TOKEN/GITHUB_REPO through compose + read from env ([046ab44](https://github.com/witchesofthehill/manabrew/commit/046ab4441370cf47393a7ab8f4def3182960183b))
- **parity:** plug memory leaks and reduce wasted CPU across runner, dashboard, and CI ([#240](https://github.com/witchesofthehill/manabrew/issues/240)) ([0f44157](https://github.com/witchesofthehill/manabrew/commit/0f441573d09f61d2e1d4c95dccdf0daa70c2f845))
- **parity:** prefer-actions mode and extensible counter types ([ba2c42e](https://github.com/witchesofthehill/manabrew/commit/ba2c42e79cfb4f3dcc490c8e176df10e3b76e5fb))
- **parity:** prefer-actions mode, extensible counters, and trigger fixes ([b838f08](https://github.com/witchesofthehill/manabrew/commit/b838f08bb1ff73595277c8e9062d5711ed69b18d))
- **parity:** prevent crash from empty env vars + limit restarts ([3f7dca8](https://github.com/witchesofthehill/manabrew/commit/3f7dca82ffdbedec8985e47bf79845b0f7ac4c7a))
- **parity:** rate-limit backfill to avoid hammering GitHub API ([438fde2](https://github.com/witchesofthehill/manabrew/commit/438fde280d5f8aea447dae074cad73a489ff8844))
- **parity:** resolve engine divergences (54% → 100%) ([ba264c7](https://github.com/witchesofthehill/manabrew/commit/ba264c7d83361e1f5cab3591b06d7ba9ed9bd3e7))
- **parity:** resolve multiple engine divergences, 54% -&gt; 83% pass rate ([ec51687](https://github.com/witchesofthehill/manabrew/commit/ec51687ee0b5c768ffb354a412c03776dd60dfd3))
- **parity:** resolve remaining engine divergences, 89.7% -&gt; 90.5% pass rate ([936a81e](https://github.com/witchesofthehill/manabrew/commit/936a81ecf9b9da02dc68ab384fb51b7e8713eef9))
- **parity:** resolve RNG divergence for random discard, 90.5% -&gt; 99.2% pass rate ([a5b03f3](https://github.com/witchesofthehill/manabrew/commit/a5b03f340dfd5ac2728d7dda4179d0dc82c9ed61))
- **parity:** Resume from last played deck pair, keep seeds stable for cache ([440eee2](https://github.com/witchesofthehill/manabrew/commit/440eee20f5e84b76edfc4a7fd0458860cab9334a))
- **parity:** Resume matrix pair position on restart, keep seeds stable for cache ([d57ade7](https://github.com/witchesofthehill/manabrew/commit/d57ade72f4624d371c2dc749e06233d0a491914c))
- **parity:** Resume scheduler from DB on restart, gate logs behind --log-level ([06588d1](https://github.com/witchesofthehill/manabrew/commit/06588d13246c773691d380dc9e9097934fb38b2c))
- **parity:** run backfill in background so main loop starts immediately ([33ef377](https://github.com/witchesofthehill/manabrew/commit/33ef3772d06cf0a189d2500f9886168162ad26f4))
- **parity:** search open+closed issues to prevent reopening duplicates ([8280d38](https://github.com/witchesofthehill/manabrew/commit/8280d383a11e912bb9b00add932105a6bd783ac7))
- **parity:** skip alternative cost spells in DeterministicController ([#128](https://github.com/witchesofthehill/manabrew/issues/128)) ([a60e562](https://github.com/witchesofthehill/manabrew/commit/a60e5625f7a289bfee26d21b4e99ea04e055a18b))
- **parity:** throttle game loop to avoid 200% CPU usage ([49179d3](https://github.com/witchesofthehill/manabrew/commit/49179d33ab778cb1d879b79c66f1d13989189d25))
- **perf:** point packaged builds at the bundled rkyv cardset archive ([#483](https://github.com/witchesofthehill/manabrew/issues/483)) ([e9aacff](https://github.com/witchesofthehill/manabrew/commit/e9aacffc2c99a959558548d9a1b8f7dcb65cb619))
- **prod:** caddy scryfall proxy regex + --remove-orphans on deploy ([#24](https://github.com/witchesofthehill/manabrew/issues/24)) ([e0bdf49](https://github.com/witchesofthehill/manabrew/commit/e0bdf4936040081a776265fd9f104e4bb8abf267))
- **prompts:** restore reveal modals + correct discard chooser ([#521](https://github.com/witchesofthehill/manabrew/issues/521)) ([50e7731](https://github.com/witchesofthehill/manabrew/commit/50e77312be938bc1039aad90db5922976df5fce4))
- **relay:** app-level keepalive so idle clients aren't dropped ([#33](https://github.com/witchesofthehill/manabrew/issues/33)) ([94aec7c](https://github.com/witchesofthehill/manabrew/commit/94aec7ccba214dceae400a6e94efdb4a623a3087))
- **relay:** diagnose + harden relay reliability on hetzner ([#79](https://github.com/witchesofthehill/manabrew/issues/79)) ([caf398f](https://github.com/witchesofthehill/manabrew/commit/caf398f0eb8386b14ce343b6b2626e360f6d93f1))
- remove bad indexed deck ([#547](https://github.com/witchesofthehill/manabrew/issues/547)) ([dd453bd](https://github.com/witchesofthehill/manabrew/commit/dd453bd1a4635698759af89d2987acd7f86d1f72))
- remove hsl() wrappers from CSS variable references ([#456](https://github.com/witchesofthehill/manabrew/issues/456)) ([b52b49a](https://github.com/witchesofthehill/manabrew/commit/b52b49a93089d622889c486c3b4618b19ca36a0b))
- remove stray comma in activated_abilities_test.json breaking wasm build ([#375](https://github.com/witchesofthehill/manabrew/issues/375)) ([48887a3](https://github.com/witchesofthehill/manabrew/commit/48887a325712d30838abbef19db690e8f2371407))
- route cross-origin fetches through platform-aware helper for web build ([#441](https://github.com/witchesofthehill/manabrew/issues/441)) ([3b46631](https://github.com/witchesofthehill/manabrew/commit/3b466313f379e44012fe5c2d84fa7f38b83ad678))
- **server:** clean up relay sessions when websocket writes fail ([#41](https://github.com/witchesofthehill/manabrew/issues/41)) ([8ba85c9](https://github.com/witchesofthehill/manabrew/commit/8ba85c96fe14f09357fdca05d086bf2ae3717792))
- Tokens are now derived from the deck ([#557](https://github.com/witchesofthehill/manabrew/issues/557)) ([afce027](https://github.com/witchesofthehill/manabrew/commit/afce02749aff9a87d2129805a45f1eea5d293c50))
- **triggers:** flush waiting triggers before SBA to prevent lost enrage-style triggers ([540c2cc](https://github.com/witchesofthehill/manabrew/commit/540c2cc4969a7eca9abced4dbab596b38216d29a))
- **triggers:** support TriggerCount$Amount SVar for Woodland Champion ([9d6a034](https://github.com/witchesofthehill/manabrew/commit/9d6a034471db3f1e423df4f0f13d7bb227ae4255))
- **ui:** better import flow and misc fixes ([#55](https://github.com/witchesofthehill/manabrew/issues/55)) ([5c56125](https://github.com/witchesofthehill/manabrew/commit/5c561257876c410cbe96894a4446ee1f48a798fe))
- **ui:** card hover preview works during autopass ([f504e5a](https://github.com/witchesofthehill/manabrew/commit/f504e5a06e0845fc2e282dcac73246f6945f10d4))
- **ui:** confirm prompt ([#526](https://github.com/witchesofthehill/manabrew/issues/526)) ([59f47c1](https://github.com/witchesofthehill/manabrew/commit/59f47c1df79bc34710504ad43ac19f2eba9300ee))
- **ui:** Deck editor UX overhaul ([#334](https://github.com/witchesofthehill/manabrew/issues/334)) ([#343](https://github.com/witchesofthehill/manabrew/issues/343)) ([4f92394](https://github.com/witchesofthehill/manabrew/commit/4f92394c053c4621b8cb96e70980864e249d3082))
- **ui:** fix slop rendering RAF and FPS handling ([#57](https://github.com/witchesofthehill/manabrew/issues/57)) ([482c645](https://github.com/witchesofthehill/manabrew/commit/482c6454e20abe361317ea22d5628541bf4479dd))
- **ui:** guard empty deck cover from undefined crash ([#481](https://github.com/witchesofthehill/manabrew/issues/481)) ([647dcee](https://github.com/witchesofthehill/manabrew/commit/647dceef0daefb96a909aa3aad520dfd44e891e4))
- **ui:** keep tapped same-name cards stacked ([#83](https://github.com/witchesofthehill/manabrew/issues/83)) ([c2f9e07](https://github.com/witchesofthehill/manabrew/commit/c2f9e0719fe4e412f07a90e5768a883901e1616c)), closes [#60](https://github.com/witchesofthehill/manabrew/issues/60)
- **ui:** prompts flashing and cursor disappearing ([#527](https://github.com/witchesofthehill/manabrew/issues/527)) ([75c8228](https://github.com/witchesofthehill/manabrew/commit/75c82282bf03ebb3463101ad9fbfec9b3e7acf83))
- **ui:** remove redundant native tooltip on card hover ([e31a58a](https://github.com/witchesofthehill/manabrew/commit/e31a58aacf545f84b6a71c542199d4800a7da1c4))
- **ui:** targeting arrows/pointers no longer dropped by hidden DOM duplicates ([#487](https://github.com/witchesofthehill/manabrew/issues/487)) ([0561775](https://github.com/witchesofthehill/manabrew/commit/0561775c54962b3705b44426c9f9c24f3d5c6aad))
- **ui:** wasm ([5e1a7a7](https://github.com/witchesofthehill/manabrew/commit/5e1a7a7165af193dd22e7aeea94e28f7fe056093))
- **web:** fix wasm multiplayer architecture ([#23](https://github.com/witchesofthehill/manabrew/issues/23)) ([aa0d060](https://github.com/witchesofthehill/manabrew/commit/aa0d060146cd2577a57d875e8f9e9f934011f0c4))
- **web:** restore worker deck availability lookup ([#363](https://github.com/witchesofthehill/manabrew/issues/363)) ([9c651db](https://github.com/witchesofthehill/manabrew/commit/9c651db9ecc86ca938dd6ca7ae70ff036c39d571))
- **web:** stabilize endgame and concede flow ([#366](https://github.com/witchesofthehill/manabrew/issues/366)) ([9c1af9f](https://github.com/witchesofthehill/manabrew/commit/9c1af9ff1e10a7aec4bfa622dbe9df05c9323a96))

### Performance

- **carddb:** pre-compile cardset to rkyv archive (~6× faster cold start) ([#465](https://github.com/witchesofthehill/manabrew/issues/465)) ([9783c6f](https://github.com/witchesofthehill/manabrew/commit/9783c6fa9508fc72496ccc6527a6870f3872a41e))
- **ops:** gzip/zstd-compress web assets in Caddy ([#27](https://github.com/witchesofthehill/manabrew/issues/27)) ([92432e2](https://github.com/witchesofthehill/manabrew/commit/92432e2aa115a8e49f62e484f6ffdc0c5a215e5e))
- **parity:** Cap JVM heap and worker count to prevent OOM on VMs ([#250](https://github.com/witchesofthehill/manabrew/issues/250)) ([41b0656](https://github.com/witchesofthehill/manabrew/commit/41b06565d171b9605f94898dec43a5f064320543))
- **parity:** Parallelize Rust/Java engines and add streaming diff + batching ([15ddbd0](https://github.com/witchesofthehill/manabrew/commit/15ddbd0116e110ea6e85bdf1473872b673e58ec7))

### Refactors

- **debugger:** extract worker thread + panic-safety fixes ([#503](https://github.com/witchesofthehill/manabrew/issues/503)) ([aa0b5dd](https://github.com/witchesofthehill/manabrew/commit/aa0b5ddea5569e9f0279f548014ffc97c6ea5fd7))
- Enforce exact 1:1 file naming parity with Java effects ([86e0efe](https://github.com/witchesofthehill/manabrew/commit/86e0efe77c1745dd498f5a72ca18f42c0ed8d0d6))
- **engine:** lower svar and produced mana ir ([#530](https://github.com/witchesofthehill/manabrew/issues/530)) ([ce30dba](https://github.com/witchesofthehill/manabrew/commit/ce30dbae6d1e81ae883dffb3c0cb71893c82c706))
- **engine:** Mad Trigger refactor ([#405](https://github.com/witchesofthehill/manabrew/issues/405)) ([22786b7](https://github.com/witchesofthehill/manabrew/commit/22786b715f69bf8db35366b03e19bfd277de51a6))
- **engine:** Pay mana, cast spell refactored ([#391](https://github.com/witchesofthehill/manabrew/issues/391)) ([ba38c7c](https://github.com/witchesofthehill/manabrew/commit/ba38c7c4b994084ae6830627c43dc51178e835ee))
- **engine:** Trigger part 2 ([#408](https://github.com/witchesofthehill/manabrew/issues/408)) ([351e48b](https://github.com/witchesofthehill/manabrew/commit/351e48baae09ed60937bcaac348443363dc08d5b))
- **lint:** clear all eslint errors and warnings ([#464](https://github.com/witchesofthehill/manabrew/issues/464)) ([8f04868](https://github.com/witchesofthehill/manabrew/commit/8f048684722406bb02421aee1b987c819fa2a8c8))
- modules in forge-harness ([#92](https://github.com/witchesofthehill/manabrew/issues/92)) ([c114a74](https://github.com/witchesofthehill/manabrew/commit/c114a74b4f863fd12517be50f9451e50e924a7b3))
- **node:** drop espresso, run java-forge on bare hotspot ([#88](https://github.com/witchesofthehill/manabrew/issues/88)) ([a7c370c](https://github.com/witchesofthehill/manabrew/commit/a7c370cb157204907a59c567fd105e885c8db8a0))
- **parity:** unify runtime entrypoints ([#529](https://github.com/witchesofthehill/manabrew/issues/529)) ([dce46ee](https://github.com/witchesofthehill/manabrew/commit/dce46eef313e4cbaa4cadc727cb274effbeb87ba))
- **ui:** Extract game components and shared modules from Game.tsx ([#72](https://github.com/witchesofthehill/manabrew/issues/72)) ([b946d6d](https://github.com/witchesofthehill/manabrew/commit/b946d6dd7b3be4176a4b73e2ef8fbc1241776095))
- **ui:** replace hardcoded colors with theme tokens ([#474](https://github.com/witchesofthehill/manabrew/issues/474)) ([cacedd3](https://github.com/witchesofthehill/manabrew/commit/cacedd3e63a1e8721bff28d01760f339eb8d54c0))
- **ui:** Replace prompt type magic strings with typed PromptType enum ([#279](https://github.com/witchesofthehill/manabrew/issues/279)) ([bd5e5f2](https://github.com/witchesofthehill/manabrew/commit/bd5e5f2c8da84ad3d0a40ac589ad72063958eca1))
