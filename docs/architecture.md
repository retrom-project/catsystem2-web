# 架构与嵌入接口

## 目标与迁移状态

目标架构由 `GameFiles`/VFS、JavaScript KCS VM、`NativeRuntime` 分派和各领域的
JavaScript 实现组成；图像与界面由 `StageRenderer` 承接，音视频使用浏览器服务。
运行时不加载或执行原 EXE 代码。原 EXE 的 x86 执行仅用于不进入 `dist/` 的离线取证
和测试差分 oracle；运行时可读取 EXE 版本资源以选择 ABI。

目标实现必须遵守以下边界：

- 运行时代码不含原 EXE 内部地址，不调用 `engine.call`、`patch` 或执行 EXE 代码区间；
  `callFromHost` 也不得用于执行 EXE 代码。地址和原执行能力只用于 oracle、离线工具与测试。
- 版本差异是 ABI 数据，包括 native ID 到语义的映射、参数签名及声音 bank 数；
  业务代码不按 profile 名分支。未登记版本必须报错，不猜用相近版本。
- E-mote/PPI 可以用 x86 执行独立 DLL，但只通过 DLL 导出表和宿主 API 交互，
  不依赖 EXE 内部地址。禁止游戏专用特判、白名单和专用全局变量。
- checkpoint 和内部接口仍在开发中，直接修改现有契约，不增加 V2、兼容读取或迁移；
  目标 checkpoint 不含 EXE 的 CPU、堆和 PE RAM 状态。
- 原处理器使用 x87；每个数学 native 的差分测试必须记录容差，或在 JavaScript 中
  复现所需精度，不能假定浮点结果逐位一致。

当前仍处于迁移期，下面描述的是尚未替换完的混合实现，不代表目标架构已经完成。
`src/engine.mjs` 和 `NativeWorld` 通过 `transitionalExe` 显式接收过渡宿主。
当前页面使用 `web/transitional-entry.mjs` 注入原 EXE 后端；纯入口的静态依赖图
由 `scripts/check-native-entry.mjs` 检查。领域模块中的剩余地址随第 3–9 阶段迁移。
共享 Windows 服务位于 `src/native/windows-services.mjs`，独立 DLL 宿主可直接使用。
运行时版本行为读取 `src/native/abi/` 的冻结数据。字符宽度、配置布局、声音协议、
消息映射和 capability 都由当前 ABI 声明。剩余纯 EXE 地址选择继续随领域迁移，
盘点的 `remainingProfileSelections` 单独列出它们及对应阶段。
scalar-math 通过语义名调用 `oracle/transitional-exe.mjs`，该层也接管游戏启动中
accelerator 的有界 WinMain 区间。`scripts/transitional-runtime.json` 明确列出
产品使用的过渡模块，开发服务器按此清单提供文件，构建按此复制 oracle 模块。
静态入口门禁同时核对页面依赖闭包，缺少清单项时失败。
`npm run check` 按文件限制现有 EXE 地址、调用和引用的数量，防止依赖增加；
规则和基线更新方式见 [完成标准](completion.md)。

## 当前混合实现

正常入口由 `NativeWorld` 驱动。`NativeRuntime` 选择固定引擎 ABI，KCS VM 持续执行
main、sscript 和辅助程序；`NativeObjects` 保存任务图和消息队列。FES、CST、运动、
声音和插件属于这些任务的服务，界面入口和流程由原系统脚本决定。

原 EXE 的已恢复处理器、解析器、图像/字体代码与 DLL/PPI 共享 PE32 地址空间。
`NativeEngineProcess` 管理指纹、已审查切点和平台边界。KCS 的数据、栈、共享区和扩展块
映射到这一进程，避免每次 native 调用复制出相互失联的内存。浏览器拥有的变量、字符串、
配置和场景资源通过各自的单份桥接同步；不能再建一个会与任务状态分叉的副本。

`GameFiles` 接收只读 `size + read(offset, count)` 文件对象，可由 File、HTTP Range 或宿主
文件系统提供。原生资源搜索保留类别、归档限定、LST 行顺序和补丁覆盖；普通目录查找保持
自己的边界。持久写入由独立 IndexedDB namespace 承接，挂载内容保持只读。

`StageRenderer`、纹理页和共享 GPU 承接原生绘制。E-mote/PPI 执行原始 DLL/插件，
以宿主 ABI 调用 WebGL2、文件、时钟等服务。媒体实际解码和播放由浏览器负责。
这些平台接口各自有范围和测试，不表示实现了整个 Windows 桌面环境。

## 嵌入

```js
import { GameFiles } from './src/files.mjs';
import { CatSystem2 } from './src/engine.mjs';
import { transitionalExe } from './web/transitional-entry.mjs';

// 在用户点击处理函数中解锁音频。
const audioContext = new AudioContext();
await audioContext.resume();
const game = await GameFiles.fromHTTP('/game.json');
const player = new CatSystem2({ game, canvas, video, audioContext, onState, transitionalExe });
await player.initialize();

await player.step();
await player.render();
const state = await player.snapshot();
await player.restore(state);
await player.dispose();
```

宿主负责串行化输入、step、render、snapshot、restore 和 dispose，避免异步资源操作交错。
逻辑帧率来自游戏配置。当前实现仍需性能验收，不能把每次 step 理解成固定的墙钟耗时。
真实键盘、鼠标、触摸和手柄经输入绑定进入原任务；释放时还应移除宿主事件和调度器。

HTTP manifest 的 `files` 为 `{path, size, url}` 数组，可另提供 `identity` 和 `media`。
Range 必须准确返回 206、Content-Range 和字节数。内容指纹按排序路径、字节数及
4 MiB 分块摘要计算；宿主提供的 identity 必须绑定其实际提供的不可变文件集合。

## 保存与恢复

游戏自己的 KCS/FES 存档链写出 CSS 容器，包括准备好的变量、字符串、图像和历史记录。
场景局部 checkpoint 另外保留选择的变量/字符串，用于原生历史与回退流程；它不是整份 World。

宿主 `snapshot()` 保存任务图、VM、句柄、共享 PE RAM、CPU、原生堆及已实现 feature 状态，
连同图像/纹理页、媒体和输入恢复信息。CPU 位图与尚未更新的 GPU 纹理页分别保存。
恢复会在新的 World 中重建服务和对象，再发布状态；内容指纹和原生来源/边界必须匹配。
Steam 账号状态、系统剪贴板等外部服务不会由游戏 checkpoint 回滚。

便携导出使用 `src/checkpoint.mjs` 的二进制容器及压缩，保留类型化数组、Map/Set、引用和循环。
当前结构化状态预算为 256 MiB；IndexedDB 事务成功之后才更新内存索引。
这是开发中的契约：同一 PFB 的中间格式直接修改，不承诺读取早期开发快照。
所有任务/媒体/转场的完整恢复仍须按 [完成标准](completion.md) 验收。

## 后续 runtime 接入

引擎仓库拥有源码、测试和 standalone 产物。当前不修改 runtime Provider、Target、adapter
或生产 lock。独立实现验收之后，再完成入口探测、内容加载、输入生命周期、checkpoint、
缓存、发行及 Retrom 产品中的真实验收。
