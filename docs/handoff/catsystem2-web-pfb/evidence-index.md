# 证据与最短复验入口

## 权威顺序与累计方式

原始 9.5MB 库位于 `.local/phase11/sdk-build-acceptance-library-3cdb/INDEX.json`；W55 提供四构建及 .23 overlay 的组索引，W67 提供五构建 thin5509。W67 的 `REFRESH-GROUP-INDEX.json` 引用已接受 W57/W59/W61/W62/W63/W64/W65/W66，`REFRESH-SUMMARY.json` 同时保留运行登记与功能分类，各 `BUILD-*-REMAINING.json` 保留未证项。W67 自己的 63 strings 是 11 新 join / 4 强化，与此前刷新分开。

后续薄增量按下表接入。每条取 **exact PE / table / id / shape+typed context**，重复 key 的新 consumer 证据只强化该形态。supporting joins、多个 build 的同体桥、同槽多次调用和先前已接受形态不能加成新 slot。本文不制造“最新全局功能数”；最新差量应读取 sealed batch 的 COVERAGE-DELTA/GROUP-INDEX 和 Root 限域。

| 已接受增量 | 功能组                                                              | 与运行版本的关系                                                                   |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| W68        | exact63 MOT typed CSS envelope / fresh reader / VM consumer         | 0prod 证据，按原限定复用。                                                         |
| W69        | Graphics60 + modern ImageOwner 两版有限消费者；以 repair1 为准      | 接受 own 修复已入 active0e9b；旧未修候选不是权威。                                 |
| W70        | exact63 Scene/globalFile/CG/log/history/recordstack                 | 69 finite joins / 10 强化是该批有限注释，0prod，不再重复加 MOT/Particle/graphics。 |
| W71        | Particle attachment/alpha/source/lifecycle/mode 与公共完成规则      | 接受 own 生产差量已入 active0e9b；693/两表0等未证边界保留。                        |
| W72        | exact63 FES named/private registry 和真实启动/退休前置              | 0prod，不能倒灌为所有历史失败的统一解释或 Sound kind13 资格。                      |
| W73        | 正常 primary Sound owner/source/clock/completion                    | accepted source-only910，尚未切入。                                                |
| W74        | modern FES typed named getter/private/context/status                | accepted source-only6cd，尚未切入。                                                |
| W75        | ImageData20B/lastowner、stored layer、scalar clip、实际消费者与退休 | accepted repair833，尚未切入；没有新的原 affine 扩张证明。                         |

W76 的 27 新 finite 注释 / 165 强化是 **待审 owner 申报**，不进入上述 accepted 累计。Config 当前 checkpoint 也不增加 native ABI 资格。机器引用只做 provenance/版本分层，不替代功能覆盖分类。

W39/W40/W42 早期 changes-required 报告必须连同已闭合 RECHECK 读取。W55 已审附录保存三个闭合指针；不能只链接原 open 报告当接受证明。旧 Main724 根亦保留旧 accepted raw/有限 port/当时 expected helper SHA；当前 helper 已漂移不能被当成旧运行逐字源。

## 局部复验方法

以下是以后需要复验时的命令入口，**本交接批没有执行**。在相同 PFB 内建立选定已接受 source 的干净隔离 worktree，先检查该仓库/子目录 AGENTS 与 Node24/固定 vendor 依赖；不得从带保护 WIP 的联合目录运行。不要为了读交接而跑全套测试、构建或游戏路线。

```sh
# 在选定、干净、已装依赖的 core checkout 中查看当前测试分组。
node scripts/test-native.mjs --list

# W73：当前契约的最短 primary source/config 消费回归。
node --test tests/native-modern-primary-sound.test.mjs tests/native-modern-primary-sound-config.test.mjs

# W74：真实 current FES caller / registry / 生命周期。
node --test tests/native-modern-fes-context-registry.test.mjs

# 仅当 W76 接受或调查它自身 finding 时，用其封定 source：
node --test tests/native-primary-loop-metadata.test.mjs tests/native-sdk63-primary-loop-metadata.test.mjs

# Config partial/VM offset：仅当前 checkpoint，不能产生 native 正证。
node --test tests/native-cross-build-configuration-checkpoint.test.mjs
```

上述 current 测试可复验公共当前行为；**不能独自补原版资格**。原版重验须沿该 batch INDEX/QUALIFICATIONS 的真实 factory/Settings/FileServer/decoder/clock/typed owner producer、实际 journal 和合法私有输入启动。缺原 PE、资源或合法 producer 时记 unproven/前置缺失，不补造 fixture 输出。先复用已接受 whole-body+context 组，必要时才补最小正常桥。

产品最短复验由 integrator 读取 `active-product` 的 PRODUCT-PLAN 与既有 native runner：先 fresh 保存全 rows/objects baseline，使用隔离新 ID，正常 SAVE→同步→关闭 writer→不同 Launch 真 LOAD→可信输入推进正文→first quit。不能直接重放会写记录的旧命令或将内部 checkpoint/截图缩略图当 GAME_SAVE。新 cut 才安排受影响 case，保存旧红和未执行 case；同 SDK/相同 KCS 可去重但内容差量必须有据。

无本机 `.local/` 时：先取得索引指定 Git source 和当前 tests/docs，使用自制 fixture 复验 current contract；完整原版/真实游戏验收另外合法准备 exact PE 与资源，固定输入摘要后重建该最短 producer/caller 链。交接目录不携带它们，不承诺摘要能重建原素材。截图若确有需要，先读 screenshot-webp skill，保 lossless 原图用于像素比较，视觉检查选择较小的 quality90 WebP。

性能只读续做：`perf-prepared` 的 HANDOFF 内有冻结 branch、source、原修复未窄复验状态和 `resumeCommand`；它明确 **当前无执行授权**。f1740 复验应恢复 `cold1740-followup` 的同内容 checkpoint/renderer/viewport/帧窗口，rapid 使用原 24click@7Hz runner，不重演主线。浏览器驱动调查沿 `video-driver` 的纯 HTML 最小复现，与引擎功能/性能门分账。

## 小型来源闭包

路径以仓库根为基准；这些链接在本机可打开，通常不随 Git 分发。完整 SHA、字节数、source 与限域保存在 [evidence-links.json](evidence-links.json)。校验只读取下列小闭包，没有重新 hash 全 raw 或重生大库。

| ID                   | 证据入口                                                                                                                                                                                                  | SHA-256 前缀        | 状态                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------- |
| neko3-story          | [.local/phase11/game-route-after-confirmed-plane-20261118/runs/route/RESULT.json](../../../.local/phase11/game-route-after-confirmed-plane-20261118/runs/route/RESULT.json)                               | `1b05b1a9b13c0c39…` | accepted-historical             |
| neko3-natural-end    | [.local/phase11/game-route-movie-input-20261118/ORIGINAL-ROUTE-NATURAL-ADJUDICATION.json](../../../.local/phase11/game-route-movie-input-20261118/ORIGINAL-ROUTE-NATURAL-ADJUDICATION.json)               | `ae81a09968ea2d34…` | accepted-historical             |
| neko3-gallery        | [.local/phase11/game-gallery-physical-stop-ed-20261118/run/RESULT.json](../../../.local/phase11/game-gallery-physical-stop-ed-20261118/run/RESULT.json)                                                   | `a53c8f4d31fb0874…` | accepted-limited                |
| H01-source           | [.local/phase11/game-gallery-owned-surface-20261118/REC-ORIGINAL-SOURCE-CUSTODY.json](../../../.local/phase11/game-gallery-owned-surface-20261118/REC-ORIGINAL-SOURCE-CUSTODY.json)                       | `0f6f837be453fdd1…` | accepted-limited                |
| active-product       | [.local/phase11/sdk-stable-functional-integration-w69-w70-20261128/FINAL-READY.json](../../../.local/phase11/sdk-stable-functional-integration-w69-w70-20261128/FINAL-READY.json)                         | `4cc4c93c54dbf939…` | accepted-active                 |
| active-product-root  | [.local/phase11/sdk-stable-functional-integration-w69-w70-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk-stable-functional-integration-w69-w70-20261128/ROOT-ACCEPTANCE.json)                 | `7bce1e0c28e5eab2…` | accepted-active                 |
| W55-root             | [.local/phase11/sdk-runtime-review-wave55/REPORT.json](../../../.local/phase11/sdk-runtime-review-wave55/REPORT.json)                                                                                     | `a8d9def444ec013a…` | accepted-baseline               |
| W67-root             | [.local/phase11/sdk-five-closure-strings63-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk-five-closure-strings63-20261128/ROOT-ACCEPTANCE.json)                                               | `b75bf0cdd847847d…` | accepted-baseline               |
| W67-groups           | [.local/phase11/sdk-five-closure-strings63-20261128/REFRESH-GROUP-INDEX.json](../../../.local/phase11/sdk-five-closure-strings63-20261128/REFRESH-GROUP-INDEX.json)                                       | `fb91520295eef08e…` | accepted-baseline               |
| W68-root             | [.local/phase11/sdk63-mot-typed-css-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk63-mot-typed-css-20261128/ROOT-ACCEPTANCE.json)                                                             | `c24fbfd541425eaa…` | accepted-evidence               |
| W69-root             | [.local/phase11/sdk-graphics-object-consumers-20261128/repair1/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk-graphics-object-consumers-20261128/repair1/ROOT-ACCEPTANCE.json)                         | `3aeb79d69cf12c6b…` | accepted-integrated-own-delta   |
| W70-root             | [.local/phase11/sdk63-scene-css-consumers-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk63-scene-css-consumers-20261128/ROOT-ACCEPTANCE.json)                                                 | `c5647da81b2820ff…` | accepted-evidence               |
| W71-root             | [.local/phase11/sdk63-particle-attachment-lifecycle-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk63-particle-attachment-lifecycle-20261128/ROOT-ACCEPTANCE.json)                             | `0a7eb91127317225…` | accepted-integrated-own-delta   |
| W72-root             | [.local/phase11/sdk63-fes-named-private-registry-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk63-fes-named-private-registry-20261128/ROOT-ACCEPTANCE.json)                                   | `fc08eb4edd0a16ae…` | accepted-evidence               |
| W73-root             | [.local/phase11/sdk-modern-primary-sound-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk-modern-primary-sound-20261128/ROOT-ACCEPTANCE.json)                                                   | `0ce26cee1c9c931e…` | accepted-pending-integration    |
| W74-root             | [.local/phase11/sdk-modern-fes-context-registry-20261128/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk-modern-fes-context-registry-20261128/ROOT-ACCEPTANCE.json)                                     | `c982931675b49d5a…` | accepted-pending-integration    |
| W75-root             | [.local/phase11/sdk-graphics-remaining-consumers-20261128/repair1/ROOT-ACCEPTANCE.json](../../../.local/phase11/sdk-graphics-remaining-consumers-20261128/repair1/ROOT-ACCEPTANCE.json)                   | `1f922cd81ba47ae6…` | accepted-pending-integration    |
| W76-ready            | [.local/phase11/sdk-primary-loop-metadata-20261128/READY.json](../../../.local/phase11/sdk-primary-loop-metadata-20261128/READY.json)                                                                     | `9dcbb3475b42908e…` | pending-review                  |
| config-checkpoint    | [.local/phase11/sdk-cross-build-configuration-metadata-20261128/READY.json](../../../.local/phase11/sdk-cross-build-configuration-metadata-20261128/READY.json)                                           | `3ee5f984207ca7b8…` | current-only-partial            |
| VM-offset-diagnostic | [.local/phase11/sdk-cross-build-configuration-metadata-20261128/ALLOCATOR-CONCLUSION.json](../../../.local/phase11/sdk-cross-build-configuration-metadata-20261128/ALLOCATOR-CONCLUSION.json)             | `ce908c3936677d91…` | diagnostic-limited              |
| cold1740             | [.local/phase11/emote-cold-f1740-20261119/F1740-COLD-ACCEPTANCE.json](../../../.local/phase11/emote-cold-f1740-20261119/F1740-COLD-ACCEPTANCE.json)                                                       | `c3ec63c623a69030…` | accepted-historical-performance |
| cold1740-followup    | [.local/phase11/emote-f1740-latency-20261119/F1740-UHD730-FINAL-ACCEPTANCE.json](../../../.local/phase11/emote-f1740-latency-20261119/F1740-UHD730-FINAL-ACCEPTANCE.json)                                 | `f912017e06580ff0…` | accepted-historical-performance |
| perf-prepared        | [.local/phase11/retrom-engine63-sdk-acceptance/wave35/prepared-resident-p2-closure/HANDOFF.json](../../../.local/phase11/retrom-engine63-sdk-acceptance/wave35/prepared-resident-p2-closure/HANDOFF.json) | `f940a23e6b4f5be2…` | frozen-withdrawn                |
| perf-hotchain        | [.local/phase11/retrom-engine63-sdk-acceptance/wave34/hot-chain-withdrawal/WITHDRAWAL.json](../../../.local/phase11/retrom-engine63-sdk-acceptance/wave34/hot-chain-withdrawal/WITHDRAWAL.json)           | `c5173c61e3df3572…` | withdrawn                       |
| video-driver         | [.local/phase11/engine63-video-context-20261122/4118-OP1-WEBGL-CONTEXT-EVIDENCE.json](../../../.local/phase11/engine63-video-context-20261122/4118-OP1-WEBGL-CONTEXT-EVIDENCE.json)                       | `5d86fc044cb347c9…` | external-limit                  |
| dense-survey         | [.local/phase11/game-real-raf-m2-geometry-20261118/ROUTE-DENSE-CHECKPOINT-PROJECTION.json](../../../.local/phase11/game-real-raf-m2-geometry-20261118/ROUTE-DENSE-CHECKPOINT-PROJECTION.json)             | `ab1900f3a5c889ff…` | input-unavailable               |

本机共享 state 中的选择字段是 `stage11OriginalRouteStory`、`stage11GalleryActualInput`、`stage11BatchVersionAbiAcceptance.acceptedActivePFBPair`、`pendingAcceptedAfter0e9b` 和各 `reviewWave*`。不要整份 dump 或修改 Root state。后续最终 cut/接受状态变化时更新本目录的薄指针，原 sealed READY/raw/接受根保持原样。
