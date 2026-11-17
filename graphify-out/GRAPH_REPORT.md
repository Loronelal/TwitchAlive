# Graph Report - TwitchAlive  (2026-11-17)

## Corpus Check
- 9 files · ~24,676 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 150 nodes · 374 edges · 13 communities (9 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `40998f8d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- favorites.js
- apply
- scanRow
- applyInventory
- manifest.json
- rawText
- popup.js
- content.js
- settings.js
- cdp.mjs

## God Nodes (most connected - your core abstractions)
1. `apply()` - 36 edges
2. `applyInventory()` - 13 edges
3. `rawText()` - 13 edges
4. `init()` - 11 edges
5. `scanRow()` - 11 edges
6. `onGqlPayload()` - 11 edges
7. `buildControl()` - 10 edges
8. `rowNeedsScan()` - 10 edges
9. `expandInventory()` - 10 edges
10. `scanCampaign()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `init()` --indirect_call--> `onGqlPayload()`  [INFERRED]
  favorites.js → favorites.js  _Bridges community 1 → community 3_
- `claimedFromInventoryJson()` --calls--> `addClaimedTo()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 5 → community 3_
- `applySafe()` --calls--> `apply()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 0 → community 1_
- `renderCampaignPills()` --calls--> `ensurePill()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 0 → community 5_
- `apply()` --calls--> `renderCampaignPills()`  [EXTRACTED]
  favorites.js → favorites.js  _Bridges community 5 → community 1_

## Import Cycles
- None detected.

## Communities (13 total, 4 thin omitted)

### Community 0 - "favorites.js"
Cohesion: 0.14
Nodes (21): applySafe(), campaignByEnds(), endsFromText(), ensurePill(), ensureStar(), findTablist(), fixClippedStar(), gameOf() (+13 more)

### Community 1 - "apply"
Cohesion: 0.18
Nodes (25): apply(), applyStarState(), buildControl(), buildDoneControl(), clearFavorites(), closePanel(), init(), onDocMouseDown() (+17 more)

### Community 2 - "scanRow"
Cohesion: 0.18
Nodes (19): ambiguousRow(), detailsNames(), endsFromHeader(), enqueueRow(), ensureRowObserver(), gameIdFromImg(), nearViewport(), observeRows() (+11 more)

### Community 3 - "applyInventory"
Cohesion: 0.15
Nodes (21): applyInventory(), campaignBadge(), campaignEntries(), claimedCount(), claimedFromInventoryJson(), claimedSection(), crossCheck(), deriveGames() (+13 more)

### Community 4 - "manifest.json"
Cohesion: 0.18
Nodes (10): action, default_popup, default_title, content_scripts, description, manifest_version, minimum_chrome_version, name (+2 more)

### Community 5 - "rawText"
Cohesion: 0.18
Nodes (20): addClaimedTo(), campaignEnds(), campaignTitleOfTower(), claimedFromPage(), claimedKey(), earnedFromClaimed(), isDeadReward(), markClaimedRewards() (+12 more)

### Community 6 - "popup.js"
Cohesion: 0.67
Nodes (3): main(), OPTIONS, renderStats()

### Community 8 - "content.js"
Cohesion: 0.19
Nodes (7): BONUS_SELECTOR, collectRewards(), extensionAlive(), recordBonus(), settings, stopTimers(), timers

### Community 73 - "cdp.mjs"
Cohesion: 0.53
Nodes (4): connect(), main(), sleep(), targets()

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `apply()` connect `apply` to `favorites.js`, `scanRow`, `applyInventory`, `rawText`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `rawText()` (e.g. with `claimedFromPage()` and `markClaimedRewards()`) actually correct?**
  _`rawText()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `favorites.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13666666666666666 - nodes in this community are weakly interconnected._
- **Why does `rawText()` connect `rawText` to `favorites.js`, `apply`, `scanRow`, `applyInventory`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `init()` (e.g. with `favorites.js` and `onGqlPayload()`) actually correct?**
  _`init()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Why does `applyInventory()` connect `applyInventory` to `favorites.js`, `apply`, `rawText`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._