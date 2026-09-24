# 英语精读

原生微信小程序，业务源码使用 TypeScript（strict）。包含书架、连续阅读、查词、AI 精读、朗读、生词闯关、学习教练、收藏、主题字体与备份恢复。

## 开发

```sh
npm ci
npm run check
```

在微信开发者工具中打开仓库根目录。`project.config.json` 的 `miniprogramRoot` 指向 `dist/`。修改源码后执行 `npm run build`；不要编辑 dist 中的生成文件。

```sh
npm run typecheck         # 严格类型检查
npm test                 # 回归测试，不连接真实 AI 服务
npm run build            # 编译 TypeScript 并复制模板、样式、字体等资源
npm run verify:templates # 本机微信编译器验证 WXML / WXSS
```

`verify:templates` 默认使用 Windows 微信开发者工具的安装目录；其他目录通过环境变量 `WECHAT_COMPILER_DIR` 指定（包含 wcc.exe 和 wcsc.exe）。

## 配置

在「我的 → 系统设置」填写 OpenAI 兼容接口地址、模型名称与 API Key。接口地址填写 `/chat/completions` 之前的部分，例如 `https://api.example.com/v1`。辅助模型用于提取词表、翻译和补全词义，未配置时使用主模型。免费词典、内置读物与已有句译不需要模型 Key。

本地兜底开关控制网络失败时是否使用内置词库与已有句译。网络自检按真实请求结果区分超时、连接失败和域名限制，不按地域屏蔽接口。微信运行环境的合法域名配置仍由开发者工具和小程序后台管理。

## 结构

- `core/`：数据模型、分词、阅读流、闯关和学习状态。
- `services/`：存储、网络、模型、词典、音频、字体及主题。
- `pages/`：11 个页面的事件、模板和样式。
- `components/icon/`、`assets/icons/`：统一线性图标。
- `data/`：原有 60 章内置内容及离线词库。
- `tests/`：数据兼容、失败恢复、状态机、网络、音频和页面绑定测试。

## 数据兼容

保留旧版本存储键、书籍/章节 ID、分词 ID 与 v3 备份格式。已有用户设置继续读取；源码不包含默认 API Key。内置内容升级保留闯关进度、笔记和划线。删除书籍/章节会同步清理失效的章节收藏与计划任务；已收藏的句子仍保留。

章节翻译失败时可选择先保存正文与词表，之后编辑重试。正文变化会重新分词，清除旧划线前会明确确认；文字笔记保留。

功能范围及重写设计见 [docs/rewrite.md](docs/rewrite.md)。
