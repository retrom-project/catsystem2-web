# CatSystem2 Web

独立运行的 CatSystem2 浏览器实现，使用 JavaScript、WebGL2、Canvas2D、Web Audio 和 IndexedDB。
当前以经过解包、解密的 NEKOPARA Vol. 3 为兼容性样本；尚未接入 retrom-runtime。
这是开发中的引擎，不能据此认为所有 CatSystem2 游戏均已兼容。

## 运行

需要 Node.js 24。浏览器使用当前 Chrome / Chromium，提供 WebGL2，并运行于 localhost 或 HTTPS。

```sh
npm ci
# /path/to/emsdk 使用固定 Emscripten 3.1.74。
python3 scripts/prepare-ppi-backend.py --emsdk /path/to/emsdk --jobs 2
python3 scripts/prepare-native-zlib.py --emsdk /path/to/emsdk
npm run dev -- --game /path/to/prepared-game --port 4101
```

打开 `http://localhost:4101`，点击 **Start game**。也可通过 **Open game folder** 选择本地目录。
输入目录保持只读，原始 `.int` 归档按需读取，不会整体装进 JavaScript 内存。
KIF 和 PSB 必须已经解密，目录还需包含与 profile 指纹匹配的引擎及其所需 DLL/PPI。
当前处于架构迁移期：浏览器仍通过固定的 x86/WASM 后端执行部分原 EXE 区域、
E-mote DLL 和 PPI。目标是以 JavaScript 实现引擎运行时，将原 EXE 执行降为离线/测试
差分 oracle；独立插件 DLL 仍可通过宿主 API 使用 x86。浏览器服务承接文件、输入、GPU、
音频及其他已实现的平台边界。启动时不进行脱壳或解密。
当前固定两版引擎；它们的来源及 SHA-256 见 [references.json](references.json)。
页面使用 `web/transitional-entry.mjs` 显式注入混合后端。直接使用 `src/engine.mjs`
的宿主可传入 `transitionalExe`；没有宿主的入口可执行已迁移的 JS 路径，遇到未迁移
操作会报告 operation 和 ABI。静态入口检查随 `npm run check` 执行。

WMV 影片需要单独安装 FFmpeg，然后执行以下命令，并重启开发服务器：

```sh
npm run prepare:media -- /path/to/prepared-game
```

转换结果位于 `.local/media/<source-identity>/`，开发服务器自动提供对应 MP4。
源归档保持原样；转换结果、游戏内容及本地验收证据都不会进入构建或 Git。
目录选择模式播放影片时，需要在所选目录提供同名 MP4/WebM；也可由宿主通过 manifest 的 `media` 映射提供影片。

点击或轻触推进；方向键／手柄方向移动焦点，Enter／A 确认，Escape／B 打开或退出菜单。
Ctrl 快进。游戏自己的标题、设置、存读档和历史窗口由其 FES 脚本绘制和控制。
页面工具栏另提供快速存读档和便携二进制 checkpoint 导出、导入。

## 验证和构建

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Node 测试可按当前依赖分组执行，`npm test` 运行全部组。

```sh
npm run test:js
npm run test:oracle
npm run test:differential
node scripts/test-native.mjs --list
```

JS/golden 组清除私有 fixture 环境变量，平台服务使用自制 PE32 内存与调用宿主。
oracle 组保留原 EXE 及私有插件回归。差分组比较两份 ABI 的独立 JS 计算路径与原 wrapper，
每份 ABI 含 27 例既有 generic/main 数学和 230 例 main 标量用例。缺少对应 EXE 时逐 ABI 明确跳过。
默认模式明确报告缺少私有资源的跳过原因。完整私有验收使用以下变量，并要求通过指纹校验。
两份 EXE 的相邻目录都需有 `config/startup.xml`。

```sh
CATSYSTEM2_ENGINE_EXE=/path/to/prepared-game/NEKOPARAvol3.exe \
CATSYSTEM2_SDK_EXE=/path/to/sdk/system/cs2_open.exe \
CATSYSTEM2_EMOTE_DLL=/path/to/emotedriver.dll \
CATSYSTEM2_PPI_FIXTURES=/path/to/ptclpi \
npm run test:full
```

测试归属和当前可执行分组见盘点中的 `testMigration`。分组与 fixture 规则见
[问题定位](docs/debugging.md)。

`dist/` 是可直接静态托管的浏览器文件及内容摘要，不包含游戏。
公共测试使用自制数据，覆盖解析边界、VM、FES、CST、E-mote、WebGL 遮罩、Range 读取和 IndexedDB。
私有游戏验证与公共测试分开运行。先按上文挂载游戏、转换影片，再执行：

```sh
npm run corpus -- /path/to/prepared-game --decode --walk 01
CAT2_GAME_URL=http://localhost:4101 npm run test:native-game
CAT2_GAME_URL=http://localhost:4101 npm run test:game
CAT2_GAME_URL=http://localhost:4101 npm run test:route
```

`corpus` 检查全部支持格式；`--decode` 解码全部 HG 无损帧与 PSB 模型；`--walk 01`
只遍历脚本命令，不验证时序、音频或画面。`test:native-game` 使用固定的
NEKOPARA Vol. 3 输入，从浏览器启动原生 World，验证语言选择、标题、真实输入和
导入 checkpoint 后的对话像素，并继续阅读到实际加载大型 HG3 后的下一段对白。
另一条用例通过真实点击推进到原场景第一个 PPI，比较粒子对画面的像素贡献，
检查新 World 恢复后整帧一致且粒子继续运行。可用 `-- --grep 'original scene particle'`
单独运行；在软件 GPU 上执行完整路径耗时较长。
`test:game` 使用 NativeWorld 的 FES、CST 字符串银行、配置和原生存档观察交互及恢复；
`test:route` 通过实际 Ctrl/Escape 输入和只读 CST reader 观察验证 14 章、5,000 条以上
对白、两部影片实际解码及返回标题。它们不再读取旧 ScenePlayer 的 story/settings/modal。

官方 SDK 4.01 有独立的冷启动与教程回归。将固定 SDK 的 `system` 目录挂载到另一端口：

```sh
npm run dev -- --port 4111 --game /path/to/sdk/system
CAT2_SDK_URL=http://localhost:4111 npm run test:native-sdk
```

SDK 和 native-game 保留 fullyParallel，默认使用一个 worker。阶段 3 的四组并发未从双 worker 获得总墙钟收益，且粒子用例触发过 60 分钟超时；可显式传入 `--workers 2` 做隔离测量。各用例的浏览器 context、IndexedDB、
World 和 checkpoint 独立，静态资源服务器只读共享。四个慢套件按阶段在不同端口并行验收。
这些用例通过实际鼠标进入教程，验证原生标题和选项画面在新 World 中逐像素恢复，
并确认恢复后的选择可以继续。鉴赏用例从教程完成注册，再打开 CG、播放和停止音乐、
进入并退出回想；可用 `-- --grep 'registers and opens'` 单独运行。完整教程路径在软件
GPU 上耗时较长。

已有浏览器可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome` 复用。
不要将私有游戏、截图、存档或反编译数据库添加到本仓库。

## 实现与验收范围

第 3 阶段的 285 个计算槽位均走 JS，包括标量、矩阵/向量、矩形/视图和 game 的
UTF-8/Unicode 输出。视图状态由 JS 持有，仍需原渲染器读取的字段单向投影；随机状态
保留已登记的 PE 绑定。[盘点与待审查原因](docs/native-compatibility.md#b-migration-inventory)
区分实现方式和验证边界。矩阵/向量有每 ABI 92 个自制 GCALL 样本，所有计算族都有
不含私有 EXE 的公共 golden 测试。

```sh
# 用已配置的两份私有 EXE 核对全部计算 golden；可在末尾指定 scalar、geometry 等族
node scripts/capture-native-calculations.mjs --check
```

正常入口运行 `NativeWorld`：KCS VM 持续执行游戏自己的 main、sscript 和辅助脚本，
保留任务图、消息队列、变量域和原生控制返回。FES/CST 通过这些任务驱动。
当前原 EXE 处理器、格式解析、字体/图像操作和插件共用一个可保存的 PE 进程；
迁移目标与边界见[架构与嵌入接口](docs/architecture.md)。浏览器 GPU/音频/文件等服务
有各自的明确契约和测试。

- [完整实现标准](docs/completion.md)：通用模拟器的完成条件及必要验收。
- [native 契约目录](docs/native-compatibility.md)：两版独立 ABI、已恢复族及未知项。
- [FES/CST](docs/fes-cst-compatibility.md)、[PPI/PTCL](docs/ppi-compatibility.md) 与
  [E-mote](docs/emote-compatibility.md)：各自的语义、执行路径和原生证据边界。
- [架构与嵌入接口](docs/architecture.md)、[问题定位](docs/debugging.md)：宿主接口、恢复和差分流程。

目前仍在开发中：全部 main native、完整初始化、FES/CST 变体、系统/鉴赏/回想全分支、
原生视觉一致性及实际运行性能均须继续验收。未知调用会携带 ABI、参数、任务和 PC 报错，
不能以返回零或继续脚本来计作兼容。标题或主线通过也不代表上述范围完成。
当前原生模型执行速度仍不足以据此宣称达到正常游玩性能。

公共测试使用自制资源；私有 fixture 用于 SDK/游戏原生差分与真实流程验证。
旧的脚本遍历或浏览器近似路径结果不能替代对当前混合路径和未来 JavaScript 路径的验收。

## 来源与许可

主要格式及执行逻辑移植自固定提交的 [CatSystemKit](https://github.com/OWCramer/CatSystemKit)。
来源、提交和 SDK 原生对照指纹见 [references.json](references.json)。
MPL-2.0；GARbro 的 MIT 归属及其他说明见 [NOTICE.md](NOTICE.md)。
本仓库不分发游戏素材或原生引擎二进制。
