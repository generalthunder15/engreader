# 字体包规范

小程序不能运行时替换样式表，字体走 `wx.loadFontFace` 动态加载 + CSS 变量注入，
所以字体以「字体包」为单位组织，分成三类：

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| 系统字体 | 无文件 | `-apple-system` / `Georgia` / `Menlo` 等系统自带族，0 体积，随时可用 |
| 内置字体包 | `fonts/<id>/`（打进小程序包） | 英文子集，每套约 60~90KB |
| 自备字体包 | `wx.env.USER_DATA_PATH/fonts/`（用户目录） | 用户在「我的 → 阅读字体 → 导入字体包」从聊天记录选 .ttf/.otf 安装，**不占小程序包体**，适合中文字体 |

## 内置字体包目录结构

```
fonts/literata/
├── manifest.json        字体包描述（下面的字段表）
├── literata.ttf         常规字重（必须）
├── literata-bold.ttf    粗体字重（可选，缺省时粗体会由系统合成）
└── OFL.txt              字体许可（OFL 等开源许可要求随包分发时保留）
```

## manifest.json 字段

```json
{
  "id": "literata",                  // 唯一 id，与目录名一致
  "name": "Literata",                // 字体名（设置页显示）
  "alias": "阅读衬线",                // 别名/分类
  "desc": "Google 为长文阅读设计",     // 一句话说明
  "version": 1,
  "family": "EngReader Literata",    // 注册到 loadFontFace 的 family 名（要全局唯一）
  "file": "literata.ttf",            // 常规字重文件
  "boldFile": "literata-bold.ttf",   // 粗体文件，没有就留空字符串
  "weight": "400",
  "style": "normal",
  "fallback": "Georgia, 'Times New Roman', 'Songti SC', serif",  // 加载完成前的替代字体
  "sample": "Reading 精读 Aa",        // 设置页预览文字
  "license": "SIL Open Font License 1.1 (OFL.txt)",
  "source": "https://fonts.google.com/specimen/Literata"
}
```

> 运行时以 `utils/font.js` 里的内联清单为准（避免运行时读包内 JSON 的兼容问题），
> manifest.json 是同构的规范文件，新增内置字体时两处都要加。

## 新增一套内置字体

1. 下载字体（建议 OFL 等可自由分发的许可），用 `font-pack-builder.py` 固定字重 + 子集化：
   ```bash
   python font-pack-builder.py <字体 id>
   ```
2. 在 `utils/font.js` 的 `BUILT_IN` 里加一条同构记录。
3. 如需在主题里推荐它，在 `utils/theme.js` 的主题对象上加 `font: '<id>'`。

## 为什么要子集化

小程序主包上限 2MB。完整英文字体动辄 1MB+，按「ASCII + 拉丁扩展 + 通用标点」子集化后
每套只要 60~90KB，长文阅读完全够用。中文字体（几 MB ~ 几十 MB）不适合内置，
走「导入字体包」装到本机，中英混排时中文自动由 CSS 字体列表里的系统字体兜底。
