# 发布准备与固定版本

## 当前可用基线

下面是 Root 已接受、当前实际服务的开发 PFB 身份，不是正式 Release：

| 项目             | 固定值                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| PFB              | `catsystem2-a39eb7faa8c2` / `http://catsystem2-a39eb7faa8c2.localhost:3000`  |
| Core             | `0e9b20b7454d06d797c5e84c88995dc6a519e757`，455 个 official 文件             |
| Core fingerprint | `cc05cbf490dcc3d8146e6191b7c75aae603ff203e0070af731064ce8d217c121`           |
| Runtime          | `8f96596d739bebcd8c7e79baeece203e3db0ffc7`                                   |
| Retrom           | `4ae4530f9401de7c95357d0a88925a676cc5a281`                                   |
| Provider base    | `02f8316709542a0dfbb34eeead80fab3f7d0a63b434df5107d821f598d37402e`           |
| 实际 dev module  | `f94f022dc54b0ffde74891cf635ae3a00b21f0daa6d3483cbc31a3d6169aace2`           |
| 不可变 host tool | `f77ce4a6b779b362e8ff1ea9ac78025a02ea27f844fc632424bb8fc5a15d3f3c`           |
| 原生存档保护基线 | 100 rows / 183 objects；后续须 fresh 逐行/逐对象字节核对，不删或覆盖旧记录。 |

接受根 `active-product-root` 和实际六 case 见证据索引。旧 `defd` Main70 raw/canonical 碰撞、`29aa/6df/c462` 清理 red 均保留为历史反证；后续 W54、W56/W58/W60 的精确公共修复不把旧失败改成通过。

## 已接受但尚未切入

| 批次                    | Source / 状态                                                                                   | 准入依据                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W73 primary Sound       | `910cf41fa7d564a4c600f65ff345bbd132586920`，accepted source-only / pending integration          | Root `0ce26cee…`；有限 matched source、completion/query/lifetime。                                                                                         |
| W74 modern FES          | `6cd95d77057e2ba576af07da9d401b97516d3d2e`，accepted source-only / pending integration          | Root `c9829316…`；真实 BASE0/typed named getter/private context/status。                                                                                   |
| W75 Graphics            | `833e7e4df9f7be1b264dff5a627fc4a7940c5929`，accepted repaired source-only / pending integration | Root `1f922cd8…`；未证 affine 扩张撤回，保有限 scalar clip/stored layer 等接受差量。                                                                       |
| W76 Soundtail           | `fca6206e7179d68cc4da4ed93d29c8570674fcdd`，accepted finite source-only / pending integration   | Root `3fc296c8…`、review `a6e7bdc1…`；6 unique case / 0 finding，保留实际原红与有限 source/decoder/host 边界；尚未部署或发布。                             |
| Config / VM offset 诊断 | `c53b046e32e53f0cc0c9c71a6c3d3c24afb366fc`，accepted current-only partial checkpoint            | joint own `71f59dc7` / `a88f79cc`，0prod/0ABI/0新原 PE；Root `de050e88…`、partial READY `3ee5f984…`，13 当前/8 配置 cold/1 诊断 cold；不代替 native 资格。 |

后续只合已接受 **own hunk**，不能复制旧候选整树覆盖新版本，也不能从联合 HEAD 把其他在途修改夹入。0prod 证明无需触发 core rebuild。首个核心 tag 拟为 `v0.1.0-rc.1`，**尚未创建**。最终 cut、资产 digest、指纹与门禁由 integrator 在独立 `RELEASE-PREPARED` 收据封定；本目录在本次事实刷新后冻结，避免把未来 cut 的自引用写回源码身份，不预填“已发布”。

## 正式链路与缺少的门

1. **封干净 core cut**：W76 已有限通过，Config 已作为 current-only partial 接受；由 integrator 只组合已接受 own 差量并封定最终 cut。保留此交接目录，检查接受 own 差量、通用行为和保护文件隔离。现在不要使用含 audio4 WIP 的施工目录构建。
2. **Core 质量与资产**：按 [现有 CI](../../../.github/workflows/ci.yml)、[候选构建器](../../../.github/rpg-runtime/build-candidate.sh) 和固定依赖重新执行 cut 所需门禁；用同源码确定性生成分发清单、许可证、归档与 SHA，确认无原 EXE/DLL/SDK/game/save/PCM/raw。历史 455 闭包通过不自动覆盖新 cut。
3. **Core 正式来源**：[retrom-fork.json](../../../retrom-fork.json) 声明仓库 `retrom-project/catsystem2-web`、defaultBranch `main`、adapter ABI `catsystem2-web-standalone`，两资产 `catsystem2-web.tar.gz` 和 `catsystem2-web-LICENSE.txt`。当前 package 是 `0.0.0-dev`/MPL-2.0；本交接基线只有质量 CI，尚无 core release workflow；拟 `v0.1.0-rc.1` 的正式 workflow/资产发布准备由 Render 负责人补齐。不得机械套一个不存在的 upstream baseline tag。顶层 README 的“尚未接入 retrom-runtime”已落后于 PFB 实际状态，正式发布前应在其 owner 范围更正。
4. **Runtime 聚合**：当前 `provider-sources.json` 仍将 `catsystem2_web` 列为 `developmentInputs`。正式发布前改为真实已发布、固定 repository/tag/commit/文件名/SHA 的 core 来源，并按 [Runtime AGENTS](../../../../../retrom-runtime/AGENTS.md) 执行 lint/typecheck/test/build/package/protocol、provider input/build/check、release build 及许可聚合；Runtime 不重新编译第三方 core。保留 Target/`GAME_SAVE`/公共 gzip 与内容身份契约，不以 PFB 源路径冒正式来源。
5. **Retrom pin 与产品门**：Runtime 正式不可变 `v*` 资产可用后，按 Retrom `make runtime-provider-pin-release`、正式 Provider 校验和 [项目验收](../../../../../retrom/docs/project-acceptance.md) 独立固定 descriptor/archive。用正常导入/Review Preview/Product Launch、方向/确认、原生写→同步→不同 Launch 冷读→正文输入→正常退出核所影响能力，fresh 保存原 100/183 及所有新数据。PFB override/watcher 的成功只属于开发候选，不能成为 production lock。
6. **授权与发布**：合并、push、PR、不可移动 tag、GitHub Release 和正式部署是后续显式动作；本批仅文档与只读盘点，没有执行。候选满足后交具体 source/资产/锁/实际结果供最终批准，不以本清单代替发布。

发布范围可以限定为已经证明的 Neko3 正常游玩和声明能力，同时明示 SDK/素材/物理硬件/性能余项。不得宣称全 SDK、全游戏或最终性能完成。跨仓门禁执行与正式行为以各仓库当时适用 AGENTS、Provider schema 和构建脚本为准。

## 保护与操作边界

`src/audio.mjs`、`src/native/audio-pcm.mjs`、`tests/fixtures/native-ms-adpcm-io-golden.json`、`tests/native-ms-adpcm-io.test.mjs` 及 `test-results/.last-run.json` 是既有五份保护 WIP，不能 stage、丢弃、混入候选或从中借合格解码器。其 SHA 留在机器引用；所有保存数据、Provider/cache 和已封原始证据保留。

日常 PFB core-inputs override + canonical watcher/restart 可重用已有 base Provider；不为源码或文档小提交造大 Provider archive。正式发布的 aggregate build 是另一道必要门。本批没有新功能测试、PE/浏览器/GPU、构建、PFB 切换或数据写入。
