# 百炼接口配置

使用北京地域 API Key，AI 与朗读共用一个 Key。主模型 deepseek-v4-flash，辅助模型 qwen-flash，朗读 qwen3-tts-flash（Cherry）。模型和地址由系统版本维护。

升级后重新填写百炼 Key；旧平台 Key 不会转发。原有学习记录保留。

微信后台 request 合法域名新增：https://dashscope.aliyuncs.com

微信后台 downloadFile 合法域名新增：https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com

已有词典与免费朗读兜底域名继续保留。音频链接转换为 HTTPS，下载不携带 API Key。

接口参考：
- https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- https://help.aliyun.com/zh/model-studio/qwen-tts-api

本地测试使用模拟响应；账户余额、模型权限及真机域名配置需通过设置页测试与朗读验证。
