# 主题包规范

主题（换肤）不是「替换样式表」——微信小程序不支持运行时替换 WXSS。本项目用
**CSS 变量注入 + 图片组件化 + 自定义底栏** 三件套实现完整换肤，所以「加一套主题」
的改动量很小：**加一个目录 + 在 `utils/theme.js` 的 `BUILT_IN` 里加一条对象**，
其余文件一律不用动。

> 配套工具（放在工作区根，不打包进小程序）：
> `theme-assets-generator.py` 生成图标注/封面/纸纹（第六节），
> `theme-check.js` 校验主题包是否接对（第八节）。

---

## 一、主题是怎么生效的

| 换什么 | 平台限制 | 本项目的做法 | 相关文件 |
| --- | --- | --- | --- |
| 颜色、圆角、排版尺寸 | WXSS 不能运行时替换 | 全部写成 `var(--token)`，页面根节点 `.page` 上用 `style="{{themeStyle}}"` 注入变量串，子元素/组件自动继承 | `app.wxss` + 各页面 wxss |
| 底栏图标（选中/未选中） | 原生 tabBar 图标只能是**包内固定图片** | 改用 `custom-tab-bar` 组件，图标用 `<image src>` 渲染 | `app.json`（`tabBar.custom`）+ `custom-tab-bar/` |
| 整页背景图 | 样式表 `background-image` 不能引用本地文件 | 用 `<image class="theme-bg" mode="...">` 铺在最底层 | 各页面 wxml 顶部 |
| 导航栏颜色 | 只能运行时改 | `wx.setNavigationBarColor` | `utils/theme.js` 的 `applyNav` |
| 字体 | 需要 `wx.loadFontFace` 动态加载 | 主题只声明**推荐字体 id**，实际加载交给 `utils/font.js` | `utils/font.js`（见 `fonts/README.md`） |

> 关键约定：**颜色的唯一来源是 `utils/theme.js` 的 `DEFAULT_TOKENS`**（「经典蓝」，
> 也是所有主题的兜底值）。`app.wxss` 的 `page { --xxx: ... }` 只是同一份数值的静态副本，
> 保证首屏渲染不闪白。

---

## 二、新增一套内置主题（三步）

### 第 1 步：建主题包目录

```
themes/<主题 id>/
├── manifest.json          主题包描述（格式见第三节）
├── cover.png              主题选择器里的缩略图（300×180）
├── tab-read.png           底栏「阅读」未选中图标（96×96）
├── tab-read-on.png        底栏「阅读」选中图标
├── tab-vocab.png          底栏「生词本」未选中
├── tab-vocab-on.png       底栏「生词本」选中
├── tab-mine.png           底栏「我的」未选中
├── tab-mine-on.png        底栏「我的」选中
└── bg.png                 可选：整页背景图（纹理/纸张），放在 images.bg
```

7 张图标/封面文件名**必须**和 `utils/theme.js` 里 `TAB_ICONS` 的 key 对应
（`themes/default/` 可直接复制改名当模板）。

### 第 2 步：在 `utils/theme.js` 的 `BUILT_IN` 里加一条

镜像「经典蓝」那条改就行（这是**唯一**必须改的代码文件）。注意**插在数组末尾时，
要给上一条末尾补一个逗号**：

```js
const BUILT_IN = [
  { /* default 经典蓝 */ },
  { /* sepia 羊皮纸 */ },
  { /* night 夜间 */ },        // ← 原来这里是 `}`（数组最后一条无逗号），插入新条目要补上
  {
    id: 'forest',                            // 唯一 id，与 themes/<id>/ 目录名一致
    name: '墨绿',                            // 主题名（设置页显示）
    desc: '深绿主色 + 纸感浅底',               // 一句话说明（设置页副标题）
    dir: '/themes/forest',                   // 主题包目录（包内绝对路径）
    font: 'system',                          // 推荐字体包 id，见 utils/font.js；不需要就写 'system'
    tokens: {                                // 只写与默认不同的 token，缺的自动兜底
      'c-primary': '#2F6E52',
      'c-primary-weak': '#E7F0EA',
      'c-primary-soft': '#EBF2EE',
      'c-primary-quote': '#F1F6F3',
      'c-bg': '#F4F7F5',
      'c-sunken': '#EEF4F0',
      'c-text': '#1F2A24',
      'c-text-sub': '#44534B',
      'c-text-muted': '#6B7A72',
      'c-text-hint': '#93A19A',
      'c-text-faint': '#BFCCC5',
      'c-border': '#E4EDE8',
      'c-mark-bg': '#EDF3E7',
      'c-mark-line': '#7FA05A',
      'c-tag-bg': '#E7F0EA',
      'c-tag-text': '#2F6E52',
      'c-sel-bg': '#2F6E52',
      'c-badge-border': '#BFCCC5',
      'c-toolbar-bg': '#1F2A24',
      'c-tabbar-text': '#7C8B83',            // 别用太浅的灰：白底上要 ≥3:1 才看得清
      'c-tabbar-on': '#2F6E52',
      'c-nav-bg': '#2F6E52'
    },
    images: Object.assign({ bg: 'bg.png', 'bg-mode': 'repeat' }, TAB_ICONS)
  }
];
```

> 这段示例**特意省略了与默认值相同的 token**（`c-card` / `c-tabbar-bg` 都是白色、
> `c-nav-text` 是 `white`、`c-on-primary` 是白色），需要时可显式写出。

> `images` 那一行是重点：`Object.assign({ ...可选图片... }, TAB_ICONS)`，
> `TAB_ICONS` 提供底栏 7 张图的标准映射，别漏掉。
> 不需要背景图就写 `Object.assign({}, TAB_ICONS)`。

### 第 3 步：确认「不用改」的地方

| 位置 | 为什么不用改 |
| --- | --- |
| `pages/mine/mine.wxml` 主题卡片 | `theme.list()` 自动遍历 `BUILT_IN`，新主题自动出现 |
| `custom-tab-bar/` | `theme.tabBarData()` 按 `TABS` 的 `icon` 字段自动取图 |
| 任何 `.wxss` | 只要用 `var(--token)` 写样式，新主题自动生效 |
| `project.config.json` | `packOptions.include` 已包含 `themes` 目录（关闭了"忽略未使用文件"，否则运行时引用的图片会被上传时剔除） |
| `utils/font.js` | 仅在需要新字体时才动（`font` 字段引用它的字体 id） |

---

## 三、`manifest.json` 字段

`manifest.json` 是**主题包的对外格式基准**（二期「从聊天文件导入主题包」会直接读它）；
运行时为了规避读包内 JSON 的兼容问题，实际以 `theme.js` 的 `BUILT_IN` 为准，
所以**两处要保持同构**。

```json
{
  "spec": "engreader-theme-v1",   // 格式版本，固定
  "id": "forest",                 // 与目录名、BUILT_IN.id 一致
  "name": "墨绿",
  "desc": "深绿主色 + 纸感浅底",
  "version": 1,
  "author": "内置",
  "tokens": { "c-primary": "#2F6E52", "...": "..." },   // 与 BUILT_IN.tokens 一致
  "images": { "cover": "cover.png", "tab.read": "tab-read.png", "...": "..." }
}
```

> 上面这块为便于阅读带了行内注释，**实际文件必须是纯 JSON**（不能有注释）。
> 可参考 `themes/default/manifest.json`，它把全部 token 都写全了，是完整的字段样例。

---

## 四、token 全表（43 个）

「作用位置」是实测的引用文件；**只写想改的 token 即可**，其余自动取默认值。

### 4.1 品牌与交互（5）

| token | 默认值 | 用在哪 |
| --- | --- | --- |
| `c-primary` | `#2B6CB0` | 主色：主按钮、选中态、标题强调、图标（app / ai-panel / mine / reader / vocab） |
| `c-primary-weak` | `#EAF1FA` | 主色浅底：标签底、Tab 未选中底（ai-panel / vocab） |
| `c-primary-soft` | `#EBF2FC` | 更浅的主色底：次级按钮/提示块（ai-panel） |
| `c-primary-quote` | `#F3F6FB` | 引用块底色（ai-panel 选中文本块 / reader 笔记弹层引用） |
| `c-on-primary` | `#FFFFFF` | **压在 `c-primary` 上的文字色**（app / ai-panel / mine），深色主色时要注意对比度 |

### 4.2 背景层次（4）

| token | 默认值 | 用在哪 |
| --- | --- | --- |
| `c-bg` | `#F6F7F9` | 页面底色（app / index / mine） |
| `c-card` | `#FFFFFF` | 卡片/面板底色（app / ai-panel / index / reader） |
| `c-sunken` | `#FAFBFC` | 凹陷区底色：输入框、内嵌块（ai-panel / mine / reader） |
| `c-mask` | `rgba(0,0,0,0.35)` | 遮罩层（ai-panel / index / reader），夜间主题建议加深 |

### 4.3 文字与边框（7）

| token | 默认值 | 用在哪 |
| --- | --- | --- |
| `c-text` | `#1A1D24` | 正文主文字（5 个文件） |
| `c-text-strong` | `#22242A` | 强文字色（预留 token，当前样式表未引用） |
| `c-text-sub` | `#4B5563` | 次级文字：释义、描述（ai-panel / vocab） |
| `c-text-muted` | `#6B7280` | 三级文字：说明、meta（ai-panel / mine） |
| `c-text-hint` | `#9AA0AA` | 占位、空状态（6 个文件，用量最大） |
| `c-text-faint` | `#C3C8D0` | 最弱文字：分隔符、时间戳（5 个文件） |
| `c-border` | `#F0F1F4` | 分割线/描边（ai-panel / custom-tab-bar / mine / reader） |

### 4.4 阅读区（9）

| token | 默认值 | 用在哪 |
| --- | --- | --- |
| `c-mark-bg` | `#FBF3E4` | 划线的文字底色（reader） |
| `c-mark-line` | `#E3B04B` | 划线的下划线/强调色（reader） |
| `c-tag-bg` | `#FBF3E4` | 词性标签底色（ai-panel） |
| `c-tag-text` | `#B4690E` | 词性标签文字（ai-panel） |
| `c-sel-bg` | `#2B6CB0` | 选中词/句的高亮底（reader） |
| `c-sel-text` | `#FFFFFF` | 选中文字的反白字色（reader） |
| `c-badge-border` | `#A8A296` | 段落笔记角标描边（reader） |
| `c-danger` | `#E24B4A` | 危险色：删除按钮、错误提示（mine / reader） |
| `c-danger-strong` | `#A32D2D` | 危险色的深色态（mine，如确认弹窗文字） |

### 4.5 划词操作栏（3）

| token | 默认值 | 用在哪 |
| --- | --- | --- |
| `c-toolbar-bg` | `#1F2430` | 划词浮动栏底色（selection-toolbar） |
| `c-toolbar-text` | `#FFFFFF` | 浮动栏图标/文字色（selection-toolbar） |
| `c-toolbar-line` | `rgba(255,255,255,0.18)` | 浮动栏内分割线（selection-toolbar） |

### 4.6 底栏与导航栏（5）

| token | 默认值 | 用在哪 |
| --- | --- | --- |
| `c-tabbar-bg` | `#FFFFFF` | 底栏底色（custom-tab-bar 样式表） |
| `c-tabbar-text` | `#8A8F99` | 底栏未选中文字色（由 JS 传给组件内联 style） |
| `c-tabbar-on` | `#2B6CB0` | 底栏选中文字色（由 JS 传给组件内联 style） |
| `c-nav-bg` | `#2B6CB0` | 导航栏底色（JS：`wx.setNavigationBarColor`） |
| `c-nav-text` | `white` | 导航栏文字色，**只能是 `white` 或 `black`**（JS 用） |

### 4.7 阅读排版（4）

被「我的 → 阅读字体」里的用户设置覆盖：用户没调过就用主题值。

| token | 默认值 | 说明 |
| --- | --- | --- |
| `read-font` | `34rpx` | 正文字号（用户可设 24–56rpx） |
| `read-line` | `2.1` | 行高倍数（用户可设 1.3–3.2） |
| `read-indent` | `34rpx` | 首行缩进宽度，`0` = 不缩进 |
| `read-para-gap` | `16rpx` | 段间距 |

### 4.8 字体与圆角（6）

| token | 默认值 | 说明 |
| --- | --- | --- |
| `font-ui` | 系统字体栈 | 界面字体，**由 `utils/font.js` 覆盖**，主题改不了（要改字体请用 `font` 字段推荐字体包） |
| `font-read` | 系统字体栈 | 阅读字体，同上 |
| `r-card` | `20rpx` | 卡片圆角 |
| `r-btn` | `16rpx` | 按钮圆角 |
| `r-sheet` | `28rpx` | 底部抽屉圆角（面板/笔记弹层） |
| `r-sm` | `12rpx` | 小元素圆角（标签、输入框） |

---

## 五、`images` 的资源清单

| key | 文件名 | 规格 | 用在哪 |
| --- | --- | --- | --- |
| `cover` | `cover.png` | 300×180，PNG | 「我的 → 主题」卡片缩略图 |
| `tab.read` / `tab.read-on` | `tab-read.png` / `tab-read-on.png` | 96×96，PNG，透明底 | 底栏「阅读」未选中/选中 |
| `tab.vocab` / `tab.vocab-on` | `tab-vocab.png` / `tab-vocab-on.png` | 同上 | 底栏「生词本」 |
| `tab.mine` / `tab.mine-on` | `tab-mine.png` / `tab-mine-on.png` | 同上 | 底栏「我的」 |
| `bg` | `bg.png` | 建议 280×280 可平铺纹理 | 整页背景图（可省） |
| `bg-mode` | —（值不是文件） | `repeat` / `aspectFill` / `aspectFit` / `widthFix` | 背景图的 `<image mode>` |
| `tabbar-bg` | 可选图片 | 建议 750×130 以内 | 底栏背景图（可省，`custom-tab-bar` 已支持） |

**路径写法**：值可以写相对文件名（相对 `dir`，最常见）、以 `/` 开头的包内绝对路径、
`wxfile://`（用户目录，主题包导入用）、或 `http(s)://`（仅调试用，正式包会因域名白名单失败）。

---

## 六、生成图标与封面

工作区里的 `theme-assets-generator.py` 用 Pillow 生成「线条款 + 填充款」两态图标、
主题封面和纸纹背景，**用现成的就不用自己画**：

1. 在脚本的 `THEMES` 字典里加一条本主题的配色：
   ```python
   'forest': {'bg': '#FFFFFF', 'primary': '#2F6E52', 'text': '#1F2A24', 'border': '#E4EDE8', 'off': '#7C8B83',
              'texture': (244, 247, 245)},
   ```
   - `primary` = 选中图标色（应等于 `c-tabbar-on` / `c-primary`）
   - `off` = 未选中图标色（应等于 `c-tabbar-text`）
   - `bg` / `border` / `text` 用于生成封面配色
   - `texture`（可选）= 背景纸纹的 RGB 基色；**写了它才会生成 `bg.png`**
     （羊皮纸就是 `sepia` 那条的 `texture: (245, 239, 225)`），
     不想要背景图就不写这一项，同时把 `images` 里的 `bg` / `bg-mode` 去掉
2. 运行（三个内置主题会一起重生成，同名文件被覆盖，图形算法固定所以结果一致）：
   ```bash
   python theme-assets-generator.py
   ```
3. 脚本只画通用图形（书 / 书签 / 人形）。想要独立风格的图标，直接替换 PNG 即可，
   保持 96×96、透明底、图形在中间 80% 安全区内（`<image mode="aspectFit">` 渲染）。

---

## 七、兜底规则与红线

1. **缺字段自动兜底**：`tokens` 只用写差异项。空字符串、`null`、`undefined` 会被忽略，
   继续用默认值（`SANITIZE` 保证）。
2. **id 必须合法**：`store.getSettings().theme` 里存的是主题 id，非法/不存在的 id
   自动回退「经典蓝」，所以删主题不会白屏。
3. **`c-nav-text` 只接受 `white` / `black`**，写其他值会被当成 `white`。
4. **浅色/深色要成套改**：只改 `c-bg` 不改 `c-text` 会撞色。建议一次改完
   「背景 4 + 文字 7 + 边框 + 主色系 5」，`c-mask` 在深色主题里要加深。
5. **对比度自检**：正文文字与卡片底、主色与 `c-on-primary` 都要能看清。
   整表检查直接跑 `node theme-check.js`（第八节）；临时试算单组颜色可用：
   ```bash
   python -c "def L(h):h=h.lstrip('#');c=[int(h[i:i+2],16)/255 for i in (0,2,4)];c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c];return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];import sys;a,b=sys.argv[1],sys.argv[2];r=(max(L(a),L(b))+0.05)/(min(L(a),L(b))+0.05);print('%.2f:1'%r)" "#1F2A24" "#F4F7F5"
   ```
   （现有三套主题的实测区间：经典蓝 3.25~16.87:1、夜间 4.48~14.63:1、
   羊皮纸 2.97~11.80:1 —— 其中羊皮纸的底栏未选中文字 2.97:1 略低于 3:1 的建议值，
   属可优化项。）
6. **体积纪律**：主包上限 2MB。图标/封面/背景都是 PNG，现有三套主题合计仅 63KB，
   单套控制在 100KB 以内没压力；背景图别用大图。
7. **不要用 `background-image: url()` 引本地图**，微信不支持 —— 一律走 `<image>` + `images` 映射。
8. **主题不能改字体**，只能通过 `font: '<字体包 id>'` 推荐；字体包见 `fonts/README.md`。

---

## 八、加完后的自检清单

**一条命令搞定**（校验器在工作区根，与 `theme-assets-generator.py` 同级，不打包进小程序）：

```bash
node theme-check.js            # 校验全部主题
node theme-check.js forest     # 只校验某套
```

它会检查并输出：

- `manifest.id` 与目录名是否一致、`name`/`desc` 是否齐全
- **是否已在 `utils/theme.js` 的 `BUILT_IN` 注册**（最常见的漏项）
- 每个 token 名是否合法（拼错的会直接报错）、是否冗余（与默认值相同）
- `c-nav-text` 是否只用了 `white` / `black`
- 7 张必需图标 + 封面是否存在、`images` 里的路径是否指向真实文件
- 7 组关键配色的**对比度**（正文底、卡片底、主色上文字、底栏、标签），低于阈值会提醒
- 反向检查：`BUILT_IN` 里注册了但目录不存在的主题

现有三套主题跑出来会有 3 条提醒，都**不影响运行**：

- `night` / `sepia`：「与默认值相同的 token（可删除）」—— 纯冗余提示（写了等于默认值的项）。
- `sepia`：「底栏未选中文字 2.97:1 < 3:1」—— 可读性偏低的既有设计，见第七节第 5 条。
- `default` 是基准主题，token 与默认值完全一致，会显示成 ✓ 而不是提醒。

**辅助检查**：

```bash
# 1) 语法与 JSON 合法性
node --check utils/theme.js
node -e "['themes/default/manifest.json','themes/forest/manifest.json'].forEach(f=>JSON.parse(require('fs').readFileSync(f,'utf8')))"

# 2) 运行时解析（mock wx 环境，用内存存储）：确认主题出现在列表、切换后变量真的生效
node -e "
const mem={};
global.wx={getStorageSync:k=>mem[k]===undefined?'':mem[k],setStorageSync:(k,v)=>{mem[k]=v},
 removeStorageSync:k=>{delete mem[k]},getFileSystemManager:()=>({}),env:{USER_DATA_PATH:'/tmp'},
 setNavigationBarColor:()=>{},loadFontFace:()=>{}};
const theme=require('./utils/theme.js');
theme.list().forEach(t=>{const miss=Object.keys(t.images).filter(k=>k!=='bg-mode'&&!t.images[k]);
 console.log(t.id,'|',t.name,'| token',Object.keys(t.vars).length,'| 缺图',miss.join(',')||'无',
 '| 底栏图',theme.tabBarData(t).list.map(x=>x.icon.split('/').pop()).join(' '));});
console.log('切换 →',theme.use('forest').name,'| currentId =',theme.currentId(),
 '| 主色 =',theme.current().vars['c-primary'],'| 背景图 =',theme.current().bgUrl);
"
```

切换那条命令的预期输出（以本文件的「墨绿」示例为例）：

```
切换 → 墨绿 | currentId = forest | 主色 = #2F6E52 | 背景图 = /themes/forest/bg.png
```

> 注意：mock 存储必须是**能保存值的**（上面的 `mem`），若写成
> `getStorageSync:()=>''` 这种空实现，`theme.use()` 写不进设置，主色会一直是默认蓝 ——
> 那是 mock 的问题，不是主题没生效。

人工检查项：

- [ ] `themes/<id>/` 里 7 张图标齐全，文件名与 `TAB_ICONS` 一致
- [ ] `BUILT_IN` 新条目的 `id` / `dir` / `images` 三处对齐
- [ ] `manifest.json` 与 `BUILT_IN` 同构（id/name/desc/tokens/images）
- [ ] 「我的 → 主题」出现新卡片，缩略图不空
- [ ] 切换后底栏图标、选中色、导航栏色都变
- [ ] 夜间/深色主题下：遮罩、`c-on-primary`、危险色对比度可读
- [ ] 阅读页划词高亮、划线、笔记角标颜色正常
- [ ] 重新打包 `engreader.zip`（主题资源已通过 `packOptions.include` 强制上传）

---

## 九、后续：主题包导入（二期）

`manifest.json` 已经按「可分发的主题包」设计好了。二期做「从聊天文件导入主题包」时：

1. `wx.chooseMessageFile` 选 zip → `FileSystemManager.unzip` 解到
   `wx.env.USER_DATA_PATH/themes/<id>/`（绕开 downloadFile 域名白名单）；
2. 读 `manifest.json` 校验 `spec` 与 `id`，与 `DEFAULT_TOKENS` 深合并；
3. 把该主题注入 `theme.list()` 的结果（`dir` 用 `wxfile://` 路径），
   图片即走「用户目录」加载，预览/底栏都能直接用；
4. 导出分享：把主题目录 zip 打包，用 `wx.shareFileMessage` 发出去。

届时主题来源会变成 `内置 + 用户导入` 两组，选择器按来源分组即可，本规范无需改动。
