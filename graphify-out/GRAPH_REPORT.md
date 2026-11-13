# Graph Report - TwitchAlive  (2026-11-11)

## Corpus Check
- 7 files · ~19,903 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .vsidx 1, (none) 1, .sqlite 1)

## Summary
- 106 nodes · 278 edges · 15 communities (11 shown, 4 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- rowNeedsScan
- apply
- applyInventory
- buildControl
- manifest.json
- paintPill
- rawText
- favorites.js
- placeStar
- mountControl
- gameOf

## God Nodes (most connected - your core abstractions)
1. `apply()` - 34 edges
2. `rawText()` - 12 edges
3. `applyInventory()` - 12 edges
4. `rowNeedsScan()` - 11 edges
5. `buildControl()` - 10 edges
6. `scanRow()` - 10 edges
7. `init()` - 10 edges
8. `renderList()` - 9 edges
9. `showToast()` - 9 edges
10. `scanCampaign()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `apply()` --calls--> `gameOf()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 14 → community 1_
- `gameOf()` --calls--> `rawText()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 14 → community 2_
- `rowNeedsScan()` --calls--> `gameOf()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 14 → community 0_
- `apply()` --calls--> `rawText()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 2 → community 1_
- `renderCampaignPills()` --calls--> `rawText()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 2 → community 5_

## Import Cycles
- None detected.

## Communities (15 total, 4 thin omitted)

### Community 0 - "rowNeedsScan"
Cohesion: 0.23
Nodes (14): campaignByEnds(), detailsNames(), enqueueRow(), ensureRowObserver(), nearViewport(), observeRows(), partsFor(), rewardNamesIn() (+6 more)

### Community 1 - "apply"
Cohesion: 0.27
Nodes (16): apply(), applyStarState(), buildDoneControl(), clearFavorites(), removeFavorite(), renderControl(), renderDone(), renderList() (+8 more)

### Community 2 - "applyInventory"
Cohesion: 0.18
Nodes (16): applyInventory(), campaignBadge(), campaignEnds(), claimedFromPage(), endsFromHeader(), gameIdFromImg(), isDeadReward(), measureAll() (+8 more)

### Community 3 - "buildControl"
Cohesion: 0.47
Nodes (6): buildControl(), closePanel(), onDocMouseDown(), openPanel(), positionPanel(), togglePanel()

### Community 4 - "manifest.json"
Cohesion: 0.25
Nodes (7): content_scripts, description, manifest_version, minimum_chrome_version, name, permissions, version

### Community 5 - "paintPill"
Cohesion: 0.50
Nodes (5): ensurePill(), paintPill(), renderCampaignPills(), renderStatsPill(), statsTimeSuffix()

### Community 6 - "rawText"
Cohesion: 0.26
Nodes (12): crossCheck(), deriveGames(), dropPercent(), earnedFromClaimed(), hashNames(), init(), loadStatsFromInventoryPage(), loadStatsViaGql() (+4 more)

### Community 10 - "favorites.js"
Cohesion: 0.31
Nodes (5): applySafe(), expandInventory(), isRelevant(), loadMoreButton(), watchDom()

### Community 12 - "placeStar"
Cohesion: 0.40
Nodes (5): fixClippedStar(), nameElementOf(), placeStar(), placeStarAbsolute(), placeStarInline()

### Community 13 - "mountControl"
Cohesion: 0.50
Nodes (4): findTablist(), hideAllControls(), mountControl(), showControlInTablist()

### Community 14 - "gameOf"
Cohesion: 0.67
Nodes (3): ensureStar(), gameOf(), makeStar()

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `apply()` connect `apply` to `rowNeedsScan`, `applyInventory`, `buildControl`, `paintPill`, `rawText`, `favorites.js`, `placeStar`, `mountControl`, `gameOf`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `rawText()` (e.g. with `claimedFromPage()` and `scanCampaign()`) actually correct?**
  _`rawText()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Why does `applyInventory()` connect `applyInventory` to `apply`, `favorites.js`, `rawText`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `rawText()` connect `applyInventory` to `rowNeedsScan`, `apply`, `paintPill`, `favorites.js`, `gameOf`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._