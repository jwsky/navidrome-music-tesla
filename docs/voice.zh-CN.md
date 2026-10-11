# 可选语音点歌服务

[English](voice.md) · [中文](voice.zh-CN.md)

基本用法仍然是一个静态 HTML：曲库播放、歌词、最爱和播放次数只需要已有的 Navidrome。
想用网页麦克风，或让 iOS 快捷指令向车机推送点歌消息时，再运行这个可选服务。

| 输入方式 | 流程 | 额外要求 |
| --- | --- | --- |
| iPhone / Siri | iOS 听写文字 → 消息服务 → 打开的播放器 | 只需消息服务，不需要转写 API Key |
| 网页麦克风 | 浏览器录音 → 消息服务 → 转写接口 → 播放器 | 消息服务，以及服务端配置的转写 Key |

服务不接收 Navidrome 密码，也不处理音乐文件。搜索和播放仍由浏览器直接访问音乐服务器。
实现只用 Python 3.10 以上和标准库内的 SQLite，不需要安装第三方包。

## 启动服务

配置和数据库放在公开网站目录之外。静态托管只需要上传 `index.html`。

```sh
git clone https://github.com/jwsky/navidrome-music-tesla.git
cd navidrome-music-tesla
mkdir -p ~/.config/navidrome-music-voice ~/.local/state/navidrome-music-voice
cp server/.env.example ~/.config/navidrome-music-voice/voice.env
chmod 600 ~/.config/navidrome-music-voice/voice.env
python3 -c 'import json,secrets; print(json.dumps({"car":secrets.token_urlsafe(32)}))'
```

编辑 `~/.config/navidrome-music-voice/voice.env`，把生成的 JSON 整体填到 `VOICE_TOKENS_JSON`，
外面用单引号包住。示例的空对象会阻止启动，先换成自己的令牌。
播放器设置和发给它的快捷指令使用同一个设备令牌；另一个接收播放器使用另一个独立生成的令牌。

| 变量 | 用途 |
| --- | --- |
| `VOICE_TOKENS_JSON` | 设备名对应随机令牌，至少 24 个字符；不要填音乐密码 |
| `VOICE_ALLOWED_ORIGINS` | 浏览器来源，逗号分隔；GitHub Pages 填 `https://jwsky.github.io` |
| `VOICE_HOST`、`VOICE_PORT` | 默认 `127.0.0.1:8787`，前面接 HTTPS 反向代理 |
| `VOICE_DB` | 放在网站目录之外的 SQLite 消息文件 |
| `ASR_BASE_URL` | 可选的 OpenAI 兼容 API 基址，默认 `https://api.openai.com/v1` |
| `ASR_API_KEY` | 可选的转写 Key，只放在服务端 |
| `ASR_MODEL` | 转写模型，默认 `gpt-4o-mini-transcribe`，可按提供方调整 |

只用 iOS 听写时，`ASR_API_KEY` 留空。网页麦克风需要自己的转写 Key，接口实现
[`POST /audio/transcriptions`](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)，
接收 multipart 音频并返回 JSON 的 `text` 字段；兼容的自建转写服务也可以。
接口可用范围和用量费用由自己的账号承担。

```sh
set -a
. "$HOME/.config/navidrome-music-voice/voice.env"
set +a
export VOICE_DB="$HOME/.local/state/navidrome-music-voice/inbox.sqlite3"
python3 server/voice.py
```

外网访问时，把自己的域名指向主机，再接 HTTPS 反向代理。
使用 [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) 的基本配置为：

```caddyfile
voice.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

把域名换成自己的。HTTPS 播放器也需要 HTTPS 语音服务。代理保留 `Authorization`，允许
`OPTIONS`；Python 服务按配置返回 CORS。不需要通配 CORS，也不要把令牌放在 URL 参数里。

### systemd 管理（可选）

仓库放在 `/opt/navidrome-music-tesla`，确保服务用户可读取；填好的配置复制到
`/etc/navidrome-music-voice.env`，然后执行：

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin navidrome-voice
sudo chmod 600 /etc/navidrome-music-voice.env
sudo cp server/voice.service /etc/systemd/system/navidrome-music-voice.service
sudo systemctl daemon-reload
sudo systemctl enable --now navidrome-music-voice.service
```

该单元会建立 `/var/lib/navidrome-music-voice` 存放数据库，不改 Navidrome 设置。
可以单独用 `systemctl stop navidrome-music-voice` 停止。

## 播放器和麦克风

打开**设置 → 语音点歌与 iOS 快捷指令**，启用后填写 HTTPS 服务地址和设备令牌。
**测试语音服务**检查连接和转写是否已配置，不会验证上游提供方。保存后保持播放器打开。

宽屏时，麦克风、排序、搜索、最爱在左侧歌曲列表下方；手机上放在顶部，收起列表后仍可使用。
齿轮设置继续在右上角。

点击麦克风，允许录音，说出歌名，再点一次结束；最长八秒，录音时暂停音乐。
浏览器选择支持的 WebM、MP4 或 Ogg，服务转发原始录音，不转换格式，也不保存。
识别失败后点播放恢复音乐。
[网页麦克风需要安全上下文和用户授权](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。
部分车机不向网页开放麦克风，可改用快捷指令。关闭语音选项会停止轮询并释放录音设备。

## 建立 iOS 快捷指令

1. 新建快捷指令，取名“车机点歌”，添加**听写文本**，选择常用语言，停止方式选停顿后结束。
2. 添加 **URL**：`https://voice.example.com/inbox`。
3. 添加**获取 URL 内容**，展开选项，把方法改为 **POST**。
4. 请求头 `Authorization` 填 `Bearer ` 加上播放器里同一个设备令牌，保留中间的空格。
5. **请求正文 → JSON**，新增文本字段，键为 `text`，值插入**听写文本**变量。
   不要把“听写文本”四个字当普通文字填进去。
6. 可加显示结果动作；`queued: true` 表示服务已收到，不能据此断言音乐已经开始播放。
7. 先运行一次完成授权，之后即可用 Siri 调用这个名字的快捷指令。

苹果的[获取 URL 内容说明](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios)
介绍了 POST 和 JSON 正文设置。听写由 iPhone 完成，不调用服务端转写接口。

```json
{"text":"播放 雪绒花"}
```

直接说歌名或歌手，可以加“播放”或 “play” 前缀。“播放我的最爱”和 “play my favorites”
会播放当前 Navidrome 账号的原生歌曲收藏。解析只去掉几个固定前缀，不支持任意歌单控制，
也不从复杂长句推断歌手；听写同音字可以配合已有的可选 AI 搜索纠错。

页面可见且空闲时，约每两秒检查消息。每台设备只保留最新一条未接收的请求，两分钟后过期。
接收是原子操作，同一条消息不会同时被两个标签页接收；建议一个令牌只用于一个接收播放器。
消息在接收后、搜索前移除，因此接收后断网或关闭页面需要重发。关闭、休眠或被挂起的页面不能
及时接收，服务也不会唤醒浏览器或绕过车机限制。

语音搜索尝试按正常播放流程播放首个匹配结果，仍受浏览器自动播放规则约束；被拦截时点一次播放。
连接和快捷指令请在停车时准备好，车机麦克风和屏幕限制以车型为准。

## 接口和验证

除 CORS 预检外，全部接口需要 `Authorization: Bearer <设备令牌>`。

| 接口 | 输入 / 输出 |
| --- | --- |
| `GET /health` | `{ "ok": true, "asr": false }`；`asr` 只代表已配置 |
| `POST /inbox` | JSON `{ "text": "播放 雪绒花" }` → HTTP 202、`queued`、`command` |
| `GET /inbox` | `command: null` 或含 `id`、`createdAt`、`expiresAt`、`type`、可选 `query` 的消息 |
| `POST /inbox/ack` | JSON `{ "id": "…" }` → 只有一个接收者能得到 `accepted: true` |
| `POST /asr` | 音频原始正文和对应 `Content-Type` → `text` 与解析后的 `command` |

上限：音频 2 MiB、JSON 4 KiB、文字 240 字符、每台设备每分钟 30 次提交、同时两次转写。
只存短期点歌文字，不存录音、音乐密码或模型密钥。HTTP 处理器不写访问日志；代理也不要记录
鉴权头和请求正文。

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p test_voice_server.py
```

测试使用虚拟曲库和本机模拟接口，覆盖设备隔离、过期、重复接收、录音格式和账号切换后的迟到响应。
