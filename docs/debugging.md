# 问题定位

先固定输入再复现。SDK 4.01 的引擎 2.6.1.74 与游戏引擎 2.6.1.76 是两个独立 ABI；
来源和摘要见 `references.json`。游戏 EXE、E-mote DLL、PPI、归档和解包记录保留在私有
fixture，不在定位过程中替换，也不把私有资源和原始反编译内容提交到源码仓库。

## 捕获运行事实

记录 `player.status()`、内容指纹、World 帧、任务/FES 栈、资源来源和调用前的 checkpoint。
独立播放器的 Diagnostics 会在错误现场保留 `failure` 字段。
未知 native 的错误带有 profile、table、ID、参数、任务、脚本和 KCS PC；
`nativeFault` 另保留原生 PC、通用寄存器和栈字。指令预算耗尽时也会记录本段入口和上限。
先保留这些事实，再定位相应原处理器。
不要把未知调用改成零返回，也不要改游戏变量或脚本绕过失败点。

用新实例恢复捕获的状态，重放相同真实输入；从新的冷启动确认修复。
改动 PE 切点、宿主 trap、对象布局或 feature 契约后，应重建开发 checkpoint。
为通过旧开发快照而添加第二套读取路径，会掩盖当前状态同步问题。

截图、IDA 数据库、原始数值日志及差分报告放在忽略的 `.local/` 中。
读取视觉截图前遵循 workspace 的 screenshot-jpeg skill；像素差分保留无损原件。

## 分层核对

格式问题先用 `npm run corpus -- <game> --decode` 检查资源。VFS 冲突需同时记录
类别、归档限定、搜索模式、LST 行和覆盖来源，不能只记录资源 basename。
字体、HG 图像、原生目标位图和 GPU 上传分别核对行地址、stride、裁剪和颜色；
某个 CPU shadow 或同源 golden 正确，不等于最终屏幕已经通过独立原生对照。

脚本问题核对 VM 数据/栈/共享/扩展区、调用帧、native 控制返回、任务消息和变量域。
FES 标签切换可能在同一帧继续执行，不能自行补一帧。CST 由原 system KCS 持续驱动，
加载 CST 不是把后续解释工作切给一个游戏专用 ScenePlayer 的边界。

声音和影片问题记录实际解码、通道、位置、音量、tag/lv、播放/暂停及完成事件。
缺失资源、浏览器解码失败与正常播放结束是不同结果，必须按原语义区分。

## 原生差分

从固定 PE 的分派表查到实际 wrapper，再追踪调用方、参数与依赖；不能把一个版本的
地址或某个调用点的参数数目推广到所有版本。使用自制最小输入运行完整原 wrapper，
尽量只在文件、系统、GPU 等已明确的平台边界供给服务。

比较返回控制码、输出字、全部写入字节/未触及 canary、共享对象、堆/引用计数、消息、
时序和生命周期。一个处理器返回 code 1 但未写结果时，保留原 `CCCCCCCC`，不能改成零。
未知或无服务的路径应携带现场报错；原本的无操作和资源缺失路径也需要自己的证据。

公共 `tests/` 使用自制数据；`scripts/verify-native-*.mjs` 和各领域 oracle 接受外部固定二进制，
将临时证据写入 `.local/`。保存修复时说明差分范围、未比较的原始未初始化字节和平台限制。
再运行相应公共用例、新实例恢复及真实系统路径。

`scripts/test-native.mjs` 按实际字面量导入闭包及私有 `process.env` 读取选择当前分组。
指向 EXE 后端、oracle 或私有 fixture 的文件进入 oracle 组。未解析的动态环境变量
读取也保守进入该组。`tests/differential/` 中的测试使用差分入口，其他可独立执行的
文件进入 JS/golden 组。JS 平台服务测试可使用自制 PE32 内存、trap 和已固定的 WASM
测试后端。每个 Node 测试文件只归入一个执行组。

`tests/native-test-plan.json` 固定原 107 个文件的目标归属，其中 oracle 33、
differential 51、JS 23，包含 92 个 Node 测试、2 个浏览器测试和 13 个辅助模块。
仍混有原 EXE 回归的文件继续实际运行在 oracle 组，状态为
`pending-domain-migration`。所属领域迁移时再调整其执行路径。盘点同时记录目标
与当前分组，`npm run check` 校验原始集合和数量。

`tests/fixtures/oracle-fixtures.mjs` 校验两份 EXE 的版本和 SHA-256，并校验指定的
E-mote/PPI DLL。提供路径但文件缺失或指纹错误时直接失败。默认模式对未提供的
资源报告具体变量及 ABI。`npm run test:full` 要求完整资源和后端齐备，缺少资源时
在执行测试前失败。完整模式仍保留明确标出的 GPU 专用 Node 跳过项，其浏览器
用例需单独按对应配置运行。

首批差分入口位于 `tests/differential/native-math.test.mjs`，自制输入由
`tests/fixtures/differential-cases.mjs` 提供。每例经真实 GCALL、`MotionInstance`
或 `NativeWorld`／`NativeRuntime` 分派执行。JS 侧的 EXE 装载入口设置为抛错，
oracle 侧通过原表取得处理器，初始计算类用例要求执行期间没有宿主 trap。

`tests/fixtures/native-differential.mjs` 记录返回值、控制码、实际结果写入、canary、
全部 VM 数据与栈、共享区和扩展块，以及完整 VM 寄存器、分配计数和调试元数据。
宿主 `memoryID` 单独排除。oracle 还检查 PE 可写节的净写入及临时分配回收。
比较器核对逻辑句柄、任务状态、分派轨迹和有序事件。当前示例覆盖同步计算，要求
无 PE 额外写入与资源分配，后续资源及异步领域接入时补充对应的观测适配。

浮点策略读取 ABI 的正常脚本环境，FPCW `0x007f`、MXCSR `0x1f80`。
当前 sin/cos、插值和向量归一化的有限 f32 输出逐字段使用 1 ULP，复制和整数逐位比较。
正负零及无穷符号精确，NaN 默认逐位精确。显式 classification 策略仍校验
quiet/signaling 分类。浮点写回范围以外的字节精确比较，重叠或越界的容差范围会失败。
插件修改 FPCW 后的跨调用影响继续保留在原有 oracle 证据中。

[native 契约](native-compatibility.md)、[FES/CST](fes-cst-compatibility.md)、
[PPI/PTCL](ppi-compatibility.md) 和 [完成标准](completion.md) 分别记录各层验收边界。
标题、主线、资源遍历、声明覆盖率和一次截图均不能代替通用模拟器验收。

## Acceptance clock and wall budgets

`CATSYSTEM2_FRAME_METRICS=1` instruments the real World tick, Engine step and
render around the test-controlled RAF. It adds observations, without replacing
production scheduling or skipping script work. Measure the wrapper separately:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/benchmark-native-frame-clock.mjs
```

This uses warmed, alternating empty-World runs and reports microseconds per
tick. It excludes production GPU/EXE work and browser IPC, so its relative
percentage on an empty World must not be presented as a game slowdown.

Private game and route gates use the reviewed progress points in
`tests/browser/progress-points.json`. Game stops at frame 1936. Route stops at
frame 883 and requires at least 54 messages. The accepted floors remain game
1636 and route 583/54. Frame counts determine the amount of guest work.

The earlier of 300 requested frames or three minutes without a completed World
frame fails the run. Script waits retain their existing `until()` frame bounds
and the overall acceptance frame budget. CST and JS writer state are attached
for diagnosis. A waiting script can continue rendering animated frames. Each pending frame batch also has the remaining
wall deadline. The diagnostic includes stack, CST position and the last 16
native calls. A completed World frame resets the no-progress deadline. This is separate
from the performance target of fifteen minutes per case.

A progress gate is explicitly annotated in Playwright and attaches its evidence.
The full UI, chapter, movie and message assertions remain in the tests.
`CATSYSTEM2_FULL_ACCEPTANCE=1` runs those complete paths. Once a case completes,
the orchestrator removes its progress budget. Progress points are updated only
after review of a stage gate.

### Opt-in tick profiles

Set `CATSYSTEM2_TICK_PROFILE` to an ignored directory to sample fixed logo,
title, early/late dialogue and model-change frame batches in the three NEKOPARA
cases. Each capture contains a CDP CPU profile and read-only host summaries.
`CATSYSTEM2_FRAME_METRICS=1` additionally records the full tick/step/render clock.

```sh
CATSYSTEM2_TICK_PROFILE=.local/perf/route CATSYSTEM2_FRAME_METRICS=1 npm run test:route -- --grep 'main route reaches'
```

Call counters are installed only for sampled batches and restored afterwards.
They include emulator entries/time, JS-to-WASM calls, memory mapping changes,
invalidation requests and read/write bytes. Read/write totals include all host
transfers, so they are upper bounds on projection copies. Instruction/TB counts
and actual invalidated TB counts are unavailable from these host observations.

Live guest bytes sum the existing allocation map. Samples include title,
frames577/1061 and periodic frames, plus collection sizes and the ten slowest
ticks. The sample array is bounded to forty entries. Raw profiles stay outside
Git. Measurements use the existing JavaScript boundaries and allocation map.

The particle regression also uses a frame budget while its full path remains
under review. Its minimum frame1114 crosses the old capacity failure at1113,
with a further300 frames available for the original assertions. A progress-only
result has the same explicit annotation as game and route.
