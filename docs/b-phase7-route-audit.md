# 第 7 阶段 FES 分发审阅

本记录只审阅 24 个已安装 KCS FES native 包装器及其默认接收器。
解释器的对象、定义、命令支持范围由 FES/CST 契约看板另行说明；EFK 仍是阶段 7
尚未完成的子系统。包装器由 JS 分发不代表这些契约全部完成。

两份冻结二进制的 native 表对应包装器均已读取完整指令路径：74 的 FES 原消息从
326 开始，76 从 331 开始；现有 ABI `control` 通道负责转换，23 查询不偏移。
实现继续使用 canonical 消息，不新增版本或签名表。SDK catalog 的空语义名保留，
审阅中的描述性 route label 单独登记；未知结构化 parameters/result/controlCodes 等
元数据不由本记录补写。

| Native ID     | 分发行为                                     | Canonical 消息         |
| ------------- | -------------------------------------------- | ---------------------- |
| 1BF           | 初始化变量域并装载 FES                       | 331、332               |
| 1C0           | 更新解释器                                   | 333                    |
| 1C1           | 绑定 Draw                                    | 334                    |
| 1C2           | 切换 block 并返回结果                        | 335                    |
| 1C3           | 绑定存档对象                                 | 336                    |
| 1C4           | 读取目标 exit code                           | 23                     |
| 1C5、1C6      | 当前任务 exit code、调用方 context name 输出 | 当前 JS 记录/VM        |
| 276、277、278 | 通知、动态声明、定义应用                     | 337、338、339          |
| 285、286、287 | local 标量写/读、睡眠状态                    | 340、341、342          |
| 289、28A      | CSS 私有 bank 保存/装载                      | 343（查询与复制）、344 |
| 298、299、29A | 命名 local、调用者私有域双向复制             | 345、346、347          |
| 29B、29C      | result 读取/清除                             | 348、349               |
| 2E2           | 将 JS encoded image data 绑定到 FES 名字     | 350                    |
| 372、373      | 命名 word 写/读                              | 352、351               |

默认 kind34 的生命周期由 `createNativeFESTask`、`FESPlayer` 和 `FESCoordinator`
负责。集合、MOT、资源 FIFO、图像、控件、文字/LOG、粒子、声音与 M2 使用 World 的
JS 权威状态；恢复不经 PE 构造或 FES 资源初始化回放。实际服务验证见
`tests/default-fes-world.test.mjs`、`tests/fes-scheduling.test.mjs` 和
`tests/native-fes-task.test.mjs`。

普通包装器传递 JS 的 `nativeVariableContextKey`。仅明确带 `context.nativePointer`
的外来调用者借助 D8 task-memory 将原任务指针映射回同一个 JS bank；边界检查验证
该 guard。显式寻址 SDK JavaScript kind55 时，接收器仍按 D8 原执行路径计数。
这些消费者不作为默认 FES 的隐藏后端。

D7 专用 draw/text/LOG/screen/owner/HG/raster 投影已从生产工厂、发布清单和导入图
删除。剩余 D8 的字节、bitmap、view/device、Windows text 与媒体消费者继续按实际
调用图登记。旧实现只通过未发布的 `oracle/fes-projection-world.mjs` 显式取证。
