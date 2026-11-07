# CatSystem2 Web

独立运行的 CatSystem2 浏览器实现，使用 JavaScript、WebGL2、Canvas2D、Web Audio 和 IndexedDB。
当前以经过解包、解密的 NEKOPARA Vol. 3 为兼容性样本；尚未接入 retrom-runtime。
这是开发中的引擎，不能据此认为所有 CatSystem2 游戏均已兼容。

## 运行

需要 Node.js 24。浏览器使用当前 Chrome / Chromium，提供 WebGL2，并运行于 localhost 或 HTTPS。

```sh
npm ci
npm run dev -- --game /path/to/prepared-game --port 4101
```

打开 `http://localhost:4101`，点击 **Start game**。也可通过 **Open game folder** 选择本地目录。
输入目录保持只读，原始 `.int` 归档按需读取，不会整体装进 JavaScript 内存。
KIF 和 PSB 必须已经解密；本项目不执行 Windows EXE、DLL、PPI，也不在启动时脱壳。

WMV 影片需要单独安装 FFmpeg，然后执行以下命令，并重启开发服务器：

```sh
npm run prepare:media -- /path/to/prepared-game
```

转换结果位于 `.local/media/<source-identity>/`，开发服务器自动提供对应 MP4。
源归档保持原样；转换结果、游戏内容及本地验收证据都不会进入构建或 Git。
目录选择模式播放影片时，需要在所选目录提供同名 MP4/WebM；也可由宿主通过 manifest 的 `media` 映射提供影片。

点击或轻触推进；方向键／手柄方向移动焦点，Enter／A 确认，Escape／B 打开或退出菜单。
Ctrl 快进。游戏自己的标题、设置、存读档和历史窗口由其 FES 脚本绘制和控制。
页面工具栏另提供快速存读档、JSON 导出与导入。

## 验证和构建

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

`dist/` 是可直接静态托管的浏览器文件及内容摘要，不包含游戏。
公共测试使用自制数据，覆盖解析边界、VM、FES、CST、E-mote、WebGL 遮罩、Range 读取和 IndexedDB。
私有游戏验证与公共测试分开运行。先按上文挂载游戏、转换影片，再执行：

```sh
npm run corpus -- /path/to/prepared-game --decode --walk 01
CAT2_GAME_URL=http://localhost:4101 npm run test:game
CAT2_GAME_URL=http://localhost:4101 npm run test:route
```

`corpus` 检查全部支持格式；`--decode` 解码全部 HG 无损帧与 PSB 模型；`--walk 01`
只遍历脚本命令，不验证时序、音频或画面。两个浏览器用例针对 NEKOPARA Vol. 3：
`test:game` 验证交互、语言和存读档；`test:route` 使用正常标题入口、Ctrl 快进和影片跳过，
遍历 14 章并检查 OP／ED 实际解码及返回标题。完整主线用例可能需要数分钟。

已有浏览器可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome` 复用。
不要将私有游戏、截图、存档或反编译数据库添加到本仓库。

## 实现范围

- KIF 文件索引、松散 patch 覆盖、按需 HTTP Range / 本地 File 读取。
- CST / CSTL、UTF-8 与 CP932 FES、KCS v2 字节码解析及 VM。
- FES 父子脚本、事件、按钮、滑块、设置、系统菜单、保存面板和历史记录。
- HG-3 无损及 JPEG＋alpha；图层、变换、动画、遮罩、色调、模糊和转场。
- PSB v2–4、E-mote 图层树、Bézier 变形、嵌套遮罩、表情、待机、眨眼、口型与惯性。
- E-mote 命中图、触碰区域、动作和反应语音，直接读取游戏的 profile／action 定义。
- Ogg/WAV 等浏览器音频、语音 `.tag` 时标及 `.lv` 口型数据、浏览器兼容影片。
- 内容指纹隔离的存档、新实例恢复及有界历史回退。

KCS 的指令集和引擎 native 服务是两个独立层。目前使用 VM 执行启动／选场景，
剧情与系统界面的引擎服务由浏览器宿主提供；**没有完整模拟任意 KCS 调用的全部 native API**。
Windows PPI 的表现由浏览器效果替代，并非逐像素复现原生插件；跨游戏兼容性、
所有菜单分支和原生视觉一致性仍需逐项验证。未识别命令和无效对象引用会保留在诊断报告中。
缺失的音频引用保留为警告并静音继续，现有音频的解码失败仍会中断并报告。
CG／动画鉴赏的登记、缩略图和回想辅助服务尚未完成，不能把主线通过视为鉴赏模式也通过。
目标样本首次进入设置时，可能需要先选择页签；启动阶段 native 的完整状态初始化仍有缺口。

参见[架构与嵌入接口](docs/architecture.md)及[问题定位](docs/debugging.md)。

## 来源与许可

主要格式及执行逻辑移植自固定提交的 [CatSystemKit](https://github.com/OWCramer/CatSystemKit)。
来源、提交和 SDK 原生对照指纹见 [references.json](references.json)。
MPL-2.0；GARbro 的 MIT 归属及其他说明见 [NOTICE.md](NOTICE.md)。
本仓库不分发游戏素材或原生引擎二进制。
