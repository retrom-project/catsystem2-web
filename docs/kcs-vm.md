# KCS 执行契约与原生对照

VM 实现位于 `src/kcs/vm.mjs`，解析入口为 `src/kcs.mjs`。
这些语义直接对照固定游戏引擎 2.6.1.76，不沿用参考实现中的推测作为验证结果。

正地址空间首先是连续的 data + stack，再接按插入顺序排列的扩展分配块；
共享内存的标记为 `0x80000000`。SP、FP 和表达式栈清理位置初始都为 dataSize。
不存在 `0x40000000` 局部栈标签。删除扩展块会改变其后分配块的虚地址。
操作数 `0x20` 是有符号标志；字节、短整数的扩展和整数比较/除法据此选择。
赋值复制位模式；编译器需要用转换指令完成类型转换。

分配先建立并清零块，再按连续区、共享区、扩展块的顺序把实际指针转换回虚地址。
零字节分配仍保留独立节点；没有命中其他已有范围时返回 `0xFFFFFFFF`。
共享区若覆盖新分配的实际地址，返回值可以带共享标签，包括零字节块。
释放先转换到实际指针，再查找扩展块的首址；共享别名也能释放原块，内部偏移不能释放它。
`0x1C` 返回是否释放，`0xED` 执行相同释放但按控制码 2 丢弃结果。

与原引擎进程相连时，data/stack、共享区和每个扩展块都使用该进程内的唯一可写 RAM。
VM 通过动态 provider 重新取得视图，避免 WASM 增长使旧视图失效。
扩展块的稳定分配身份与可移动的虚地址分开；已经借出的原生指针不会随块删除或解释器替换改指向。
释放后的地址仍遵循原分配器的复用行为。快照保存逻辑身份、字节和 guest 地址，
在新进程重建 provider；不保存 host 指针。详见 [Script 共享内存契约](native-script-tasks.md)。
物理分配和释放使用同步 allocator binding，回调不进入快照，新进程重建绑定。

CALL 的三个栈字依次为返回 PC、旧 FP、旧清理位置。RETURN 能复制多字结果，
并恢复三者。跳转及 opcode 60 清理到当前表达式栈底，不是只 pop 一个结果。
有效分派表有 69 槽，63/64 为空；NOP、STORE、COPY、DUP 也有真实处理器。
65–68 是源码位置、函数和调试符号作用域信息。

GCALL 的第二个操作数规定实参字节数。回调返回值是控制码，不能当作参数数量：

| 控制码 | VM 行为                              |
| ------ | ------------------------------------ |
| 0      | 暂停，无结果                         |
| 1      | 压入结果，继续                       |
| 2      | 无结果，继续                         |
| 3      | 压入结果，暂停                       |
| 4      | 无结果，暂停                         |
| 5      | 恢复实参和当前 GCALL 的 PC，下次重试 |

宿主返回 `nativeReply(control, value?, wait?)`。未知调用和不正确的结果协议抛出有位置的错误，
不返回默认 0。浏览器异步 I/O 由 scheduler 在当前逻辑帧内等待并恢复该调用，
操作只执行一次；这与 guest 主动暂停到下一帧不同。
GCALL 每次独立分配实参数组并顺序读取当前栈，不复用宿主持有的数组。VM 按原顺序
一次取得 reply 的 control/value/wait 并校验，直接消费这些局部值；不再创建随后即丢弃的
第二个标准化 reply 对象。getter、诊断、结果入栈和 wait 复制的次序保持。

`NativeRuntime.register(table, id, handler)` 的内部回调接收
`(args, machine, task, scheduler)`；installer 通过闭包持有它自己的 World 和服务。
准入检查先拒绝 unknown 槽位，再处理已证实的 reserved/constant 和已注册回调。
这些路径不构造内建 fallback 的临时服务对象，也不隐式选择或创建变量/字符串 bank。
需要这些操作的回调必须通过它持有的 World/runtime 明确执行。

只有进入主表内建 fallback 时才从当前 `runtime.services` 构造本次调用的服务视图，
保留 getter 的本次读取、当前任务/上下文和 bank/scene 服务的原有选择规则。
该对象不跨 GCALL 缓存。所有分派路径仍检查固定 ABI 的控制码，并保留同步异常、
异步完成和 guest 暂停的原有顺序；内部回调不额外接收这个服务对象。
普通 World 的已实现 MOT、round、lerp 和 spline 包装通过同一注册入口执行，
每次只捕获该族实际消费的当前服务及创建调用的 `task.id`；冷加载已开始的调用保留
自己捕获的服务，下一次调用重新读取当前 World，不跨 GCALL 复用临时视图。

原 GCALL 每次将 native 的输出槽初始化为 `0xCCCCCCCC`。控制码 1/3 得到该值时，
原生只记录诊断，随后仍将该字入栈。主表 `0x8C/8E/225` 的原处理器确实只返回 1，
没有写输出；因此这三个已证实槽位显式返回该哨兵值，并保留 VM 诊断，不能改成 0。
它不表示上次 native 的结果；`nativeReply(1)` 缺少显式结果仍然报错。

`native 0x47` 将一个 16 字节缓冲注册为消息接收位置后暂停。普通帧恢复时压入 0；
消息递送时复制四个字、压入 1，并执行到下一个暂停点。队列消息在正常帧执行之前依次递送。
这些行为分别来自消息等待、立即递送、正常帧恢复和任务帧函数，不能用空消息 native 替代。

## 窄字符串格式化

五个已登记构建的 VM 窄格式器都按原始字节处理 `[G/L/H]` 引用。
`%s` 先递归格式化，再按字节应用 width/precision；截断双字节字符时保留原始 lead byte，
在拼接完成之前不解码为 Unicode。字符串、资源名和日志消费端决定最终文本编码。
数值字段支持已证明的 32 位/短整数、字符、指针显示和 `%f`；宽字符和未证明的
64 位参数布局仍不准入。`%F` 读取参数但不产生字段。
整数 precision 也按原 CRT 截至 512；短整数先截为 16 位，再决定十六进制 `#` 前缀，
因此高 16 位非零而低 16 位为零时，`%#hx` 输出 `0`，`%#.0hx` 输出空串。

固定小数遵循原 CRT 的 17 位有效十进数字和最多 512 位小数精度，
包括非有限数的原始文字及低精度舍入。格式器使用显式工作栈，不额外限制合法嵌套层数。
五版构造器的数值临时区为 `0x2800` 字节；每次递归 `%s` 的原局部缓冲为 `0x800` 字节。
超过实际缓冲或形成循环引用的输入继续诊断，不使用 JavaScript `toFixed` 的边界代替原约束。

公共 `native-format-golden.json` 保存五版原始物理结果已逐字节相同的作者输入。
`native-logger-golden.json` 另外保存真实 Main1/Main14、Generic debug 和现代两个 Particle 表
经过实际 CRT logger 的字节结果；第一层格式器结果不能代替调用方容量证明。
Main1 按原循环转义百分号，Generic/Particle 直接交给第二层 logger。
logger 的 500 字节局部区必须容纳终止 NUL：499 字节正例通过，原 500 字节不终止形态继续诊断。

旧三版 `.23/.63/.67` 的 Generic0、Particle-v1/2 的0另由
`native-legacy-aux-logger-golden.json` 关联各自原件指纹：每版执行21个完整原 GCALL，
保留本版完整入口、格式化器和实际 CRT logger，仅捕获有限的 Win32 日志窗口传输叶端。
`.23` 的包装先翻译虚地址，其余两版由格式化器翻译；不能按现代41字节包装直接套用。
每版两张 Particle 表确实选择同一入口，三个解释器仅使用各自 scratch，不读取或修改 receiver 字段。
当前生产 KCS 的63组整段局部/共享/数组内存、日志字节、control2、无结果写入与栈哨兵逐一匹配，
18个独立 checkpoint 冷恢复继续同一调用。首参数读当前 argv，编码宽度为0仍可读取已映射首词，
额外尾词被忽略。CP932、两层百分号、浮点和499字节终止边界保留五版共同格式器契约。
这些接口将日志交给宿主已有调试回调；没有打开原生调试窗口或发送真实 OS 消息的声明。
新增九个准入入口不代表全部 SDK、所有格式组合或其他资源/宿主形态完整。

未提供 native variadic 参数而遗留的有效 CRT 转换也继续诊断。

五版 Main1/Main14 包装读取固定的一个/两个 argv word，独立于 GCALL 声明长度；
已映射短帧和额外尾字按原版读取，未映射 word 仍报实际地址诊断。
Main14 先完成格式化再复制，支持源目标重叠，写两个终止 NUL 并返回原 VM 目标地址。
其共享全局 scratch 的 1024 字节及更长输出仍是单独容量/布局审计边界，
现代原版 4096 字节例会覆盖后邻矩阵索引；直接格式器的 10KiB 临时区证明不关闭这个边界。

五版原 CRT 的 `%n` 默认关闭。有效目标指针也进入 invalid-parameter 路径，
设置 errno 22 并走原终止诊断；当前实现保留诊断且不写目标。
原 getter/初始化和 OS 叶捕获与未绑定宿主叶的失败记录分开封存。
未证明的 count-output 启用状态、宽/64 位布局不准入；底层 owned buffer 的可写能力本身不启用 `%n`。
旧三版 Generic0 的原版捕获保留，但其原有未准入状态未因共享 formatter 修复而改变。
完整原字节、控制码、内存和宿主边界收据单独封存，整个 SDK 仍未完成。

## 固定切点

所有地址只适用于 `references.json` 中的游戏 EXE SHA-256。

| 切点             | VA                            |
| ---------------- | ----------------------------- |
| VM 指令分派表    | `0xB49A00`                    |
| 连续执行循环     | `0x876430`                    |
| 操作数读取       | `0x876CA0`                    |
| 虚地址转宿主地址 | `0x8772A0`                    |
| 分配/释放        | `0x876320` / `0x876800`       |
| GCALL            | `0x87A330`                    |
| CALL / RETURN    | `0x87A2A0` / `0x87A4C0`       |
| 消息等待 / 递送  | `0x8774C0` / `0x877440`       |
| 普通帧恢复       | `0x8775A0`（内联 `0x8763D0`） |
| 脚本任务每帧调度 | `0x5E8CB0`                    |

SDK 2.6.1.74 的指令分派表为 `0xC53D00`，槽位布局相同。
尚未将两个二进制的所有处理器逐条证明为相同实现。

## 可复现验证

使用本地 gcc 的 ELF32 支持构建私有 oracle：

```sh
python3 scripts/native-vm-oracle.py --exe /path/to/fixed/prepared/NEKOPARAvol3.exe \
  --output .local/analysis/native-vm-oracle
node scripts/verify-native-vm.mjs .local/analysis/native-vm-oracle/kcs-native-oracle \
  .local/analysis/native-vm-differential.json
```

构建器核对固定 EXE SHA-256，以原 VA 映射 PE 节，调用原始 x86 指令处理器。
它不会运行 PE 入口、游戏初始化、DLL 或 Windows 服务。memcpy、日志及 CRT 浮点异常通知
由 harness 替代；转换本身的数值路径仍执行。涉及这些平台通知的外部副作用不在验证范围内。
生成的 ELF 含私有二进制字节，只能留在忽略目录，不进入构建或 Git。

当前 3,116 个自制用例比较 PC、SP、清理位置、FP、switch 寄存器、完整局部内存及共享内存，
覆盖数值/指针/调用、控制码、子字访问、NaN 位模式及调试位置。另有两版各 1,866 项
原生调试对照，覆盖 66–68、CALL/RETURN 的函数地址栈和符号作用域、Script 164/165/168。
两版各 666 项完整 GCALL 对照验证真实空返回处理器、每次哨兵初始化、全部内存及诊断次数。
另有两版各 7,146 项分配对照：每版执行 252 次完整 1B/1C/ED 包装及 600 次原始逆地址转换，
检查零块、共享别名、全部分配字节、链计数及隐藏 heap 引用。
外部调试器的容器初始化由 harness 明确提供；越界帧读取与首次 65 前的未初始化源码位置不计通过。
详见 [Script 契约](native-script-tasks.md)。操作数所有组合、完整任务图与主 native 的外部副作用
仍需要各自的对照，不能从用例数推出全覆盖。
公共 `tests/kcs-contracts.test.mjs` 保留关键数值和生命周期回归，无需私有二进制。

SDK 的 186 份与游戏的 103 份 KCS 还逐条检查 codeSize 的指令边界和 header，
目前均可解码。这是语料解析证据，不能称为全部脚本执行通过。
PTCL 的全语料执行单独由粒子模块记录。

## Container version diagnostics

The JS reader verifies the signature, declared header length, compressed body,
string ranges, allocation counts and stack limit before reporting version
metadata. The reviewed small set is container format 2 / header 52 bytes and
script versions 0.0, 1.0 and 2.0. A structurally readable unverified version
emits one console diagnostic per version and source SHA-256, then continues with
the same reader. This diagnostic neither selects an engine ABI nor implements
unknown VM instructions, native calls or plugins. Header extensions use the
declared header length when resolving absolute table/debug offsets.

FES text/packed and CatScene containers have no recovered version field. Their
size or reserved words are not promoted to a version or an ABI loading contract.
Malformed bodies and ranges still fail explicitly.
