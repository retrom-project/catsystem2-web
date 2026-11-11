# Domain 6 路由与剩余消费方复核

6.7 按 `installNativeGraphics` 的真实注册表逐项追踪，再经过
`NativeEngineMessages.dispatchNative/route` 核对接收器。两个 ABI 各 57 个
unknown 是 35 个 graphics、20 个 draw-task 和 2 个 mesh 包装器，均已有 JS 实现。
语义名从当前消息契约恢复；例如 `0x62` 是按钮状态查询，`0x108` 发出计数查询但
刻意丢弃结果、返回 control 2。保留原 catalog 名供对照，不修改运行时 ABI 表或选择逻辑。

可重跑证据在 [render-route-audit.mjs](../scripts/render-route-audit.mjs)、
[render-route-audit.test.mjs](../tests/render-route-audit.test.mjs) 和
[b-migration.json](b-migration.json)。测试从两个 ABI 的实际安装处理器捕获消息序列，
并用真实 M2 JS 接收器加进程替身核对条件分支，不装载或执行 EXE。

看板的 `pure-js` 指该 domain 的包装器和普通接收器；`renderRoute.consumerRoutes`
另列可到达的原处理器，不把条件 EXE 路径隐藏为无条件纯 JS：

| 目标                                     | 当前接收器与状态                                             | 删除阶段                       |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| kind 2 / 6                               | JS Plane / BasePlane 子集                                    | 本阶段已完成                   |
| kind 15                                  | JS Draw、保留源、ANM 和位图栅格器                            | 本阶段已完成                   |
| kind 40 / 41 / 42                        | 原 Scroll / Scroll2 / Slider 控件消息                        | 7                              |
| kind 55，capabilities.embeddedJavaScript | 原 SDK JavaScript 任务消息                                   | 8                              |
| kind 54，plugins.emoteDriver = native    | 9 个公共 Plane 入口可进入 M2 原消息接收器，其余交给 JS Plane | 9                              |
| FES/外部生产者的 nativePointer 包        | 显式导入 PE 位图、源表和 ANM 状态；JS 持有绘制状态           | 7，外部任务记录分别随 8/9 删除 |

两个 particle 表各 `rand`/`frand` 的 4 条审查项是已知共享 ParticleRandom 数据页绑定，
没有原随机处理器执行。改为已追踪证据，保留 phase-10 随 x86 后端删除的登记。

| 文件                                       | 实际剩余用途、权威方和投影范围                                                                                                                         | 归属/删除                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| oracle/bitmap-memory、bitmap-projection    | JS bitmap-data 为普通脚本位图权威；为 FES/外部任务复制像素、元数据、属性、wrapper。PE 生产者的借用视图在显式导入/发布边界传递值                        | 归属 7；FES 7、SDK/输入 8、M2 9 分别拆除 |
| oracle/image-owner、image-owner-projection | 只有 FES IMAGEEX `refex` 物化 64 字节 collection、独立 wrapper、帧树和程序引用。JS 已负责 ANM、层合成和输出，不调用原 rendererDraw，也不回读其派生输出 | 7                                        |
| oracle/hg3-delta                           | 既有有界 HG 行展开边界。当前启用额度的生产入口只在 FES task/image 的 decodePointer/decodeBitmapPointer；普通脚本、粒子纹理和 PPI atlas 已由 JS 解码    | 7                                        |
| engine-files 的 anmtable.csv 借出          | 剩余 FES/SDK/M2 消费视图构造一次私有 map；脚本查询、JS Draw/ANM 均使用 JS 表。无反向刷新                                                               | 按 7/8/9 拆除                            |

删除 `exe-owner-renderer-to-js-derived-output` 登记；其中 captureRendered/rendererDraw
在生产调用链已不存在。其余 helper 全部继续纳入 EXE 地址/调用基线，没有移出扫描范围。
剩余文件的 EXE 生命周期站点仍保留审查状态；本次仅清结 domain 6 的已知分派，
不代表提前完成 FES、SDK 或插件领域。

共享投影的最终删除阶段按已批准的 6 → 9 → 7 → 8 顺序计算。插件输出在 9 删除；
FES 和影片/SDK 的共享表面或视图借用分别保留到 7/8，聚合记录因此最迟为 8。
原 view 初始化中的 M2/DLL 胶水须在 9 切断，不能因剩余 FES/媒体记录继续装载 DLL。
