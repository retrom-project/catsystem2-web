# 架构与嵌入接口

`GameFiles` 统一归档与松散文件。它接收只读的 `size + read(offset, count)` 文件对象，
因此浏览器 File、HTTP Range 或未来的 runtime 文件系统可以实现同一个窄接口。
默认按需加载资源，归档表与资源解码分开；模型及图片使用有界缓存。

`formats/` 拥有二进制格式和边界检查。`kcs.mjs` 的 VM 拥有数据段、调用栈和共享内存，
`BootHost` 实现启动阶段需要的 native 服务并记录调用清单。它不是原生 API 的完整模拟器。
`fes/` 解释游戏提供的系统界面；`scene.mjs` 解释剧情，`stage.mjs` 保存可序列化的画面状态与动画。

E-mote 配置转换为模型及姿态，`draw-list.mjs` 将树变成绘制项、变形节点与遮罩。
WebGL2 顶点着色器沿祖先链计算 Bézier 变形，片段着色器组合 atlas 与 alpha 遮罩。
Canvas2D 组合背景、角色、效果和 FES。音频、影片、IndexedDB、输入属于浏览器宿主。
没有 Apple 框架依赖，也不装载 Windows 插件。

## 嵌入

```js
import { GameFiles } from './src/files.mjs';
import { CatSystem2 } from './src/engine.mjs';

// 在用户点击处理函数中先解锁音频。
const audioContext = new AudioContext();
await audioContext.resume();
const game = await GameFiles.fromHTTP('/game.json');
const player = new CatSystem2({ game, canvas, video, audioContext, onState });
await player.initialize();

await player.step(); // 逻辑帧为 1/60 秒；宿主负责调度和串行化操作。
await player.render();
const state = await player.snapshot();
await player.restore(state);
await player.dispose();
```

HTTP manifest 的 `files` 为 `{path, size, url}` 数组；可提供 `identity` 和 `media`。
Range 必须准确返回 206、Content-Range 和字节数，不接受服务器以完整响应替代小范围读取。
目录树内容指纹按排序路径、字节数和 4 MiB 分块摘要计算；本地 File 与开发服务器使用同一算法。
宿主提供的 `identity` 必须绑定它实际提供的不可变文件集合。

输入通过 `click`、`hover`、`confirm`、`cancel` 及 FES 的 `moveFocus` 分发。
动作和 step/render/snapshot/restore 必须串行，避免用户操作在异步资源加载中间修改状态。
退出时释放 GPU、音频、IndexedDB 和影片 URL；宿主还应移除自己的事件与调度器。

## 存档

原生 FES 存档操作保存当前剧情、画面、变量、音频及有限的回退位置，加载时重建消息窗。
公共 `snapshot()` 还保存 FES 运行位置和界面对象。JSON 保存格式为当前开发格式，
不提供早期开发快照的兼容读取；尚未冻结 runtime checkpoint ABI。
每份存档上限为 16 MiB，IndexedDB 事务完成之后才更新内存索引。
恢复前核对整份游戏内容指纹；不会把错误存档回退成新游戏。

历史回退保留最近 200 个消息位置，历史文本随当前存档保留最近 500 条。
回退重建剧情与画面，并从该位置重新播放音频，不保存 Windows 原生进程状态。
影片播放期间拒绝保存。尚未将转场的前一帧像素写入存档，因此转场中捕获的状态不承诺像素级恢复。

## 后续 runtime 接入

引擎仓库拥有源码、测试和浏览器分发文件。当前没有 Provider declaration、Target、
runtime adapter、候选包或生产 lock 变更。接入时应单独完成入口探测、内容加载桥、输入生命周期、
checkpoint 语义、持久缓存、发行产物及 Retrom 的真实产品验收；不能以本项目的 standalone 验证代替。
