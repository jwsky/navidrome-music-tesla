# 自建搜索后端接口约定

设置里填了「自建搜索后端」之后，前端会往这个地址发三种请求。三个都实现才算完整，
但只实现 `/search` + `/play` 也能用（只是那些歌没有歌词）。

请求全是 `GET`，返回 `application/json`。因为是浏览器直连，**服务端必须带上 CORS 头**：

```
Access-Control-Allow-Origin: *
```

假设你填的地址是 `https://example.com/api`，那么：

## GET /search?q=关键词

```jsonc
{
  "results": [
    {
      "id": "12345",
      "title": "歌名",
      "artist": "歌手",
      "duration": 269,           // 秒，可选
      "cover": "https://…/x.jpg",// 可选，没有就用内置占位图
      "play": { "id": "12345", "platform": "xxx" }
      // play 是个自由字典，前端会原样拼进 /play 和 /lyric 的 query。
      // 不给的话默认用 {id: id}。
    }
  ]
}
```

## GET /play?<play 里的键值>

返回一个浏览器能直接塞进 `<audio>` 的地址：

```jsonc
{ "url": "https://…/song.mp3" }
```

这个地址所在的服务器也要允许跨域播放（或者干脆由你自己中转）。

## GET /lyric?<play 里的键值>

```jsonc
{
  "lines": [
    {
      "start": 21500,          // 该行开始时间，毫秒
      "value": "原文歌词",
      "roma":  "luo ma yin",   // 可选，罗马音/音译
      "trans": "中文翻译",      // 可选
      "chars": [               // 可选，原文的逐字时间轴
        { "o": 0,   "d": 260, "c": "原" },
        { "o": 260, "d": 240, "c": "文" }
      ],
      "romaChars": [           // 可选，罗马音的逐字时间轴
        { "o": 0,   "d": 300, "c": "luo " },
        { "o": 300, "d": 300, "c": "ma " }
      ]
    }
  ]
}
```

`chars` / `romaChars` 里的 `o` 是**相对该行 `start` 的偏移**（毫秒），`d` 是这个字唱多久。
给了就有逐字扫光，不给就退回整行高亮。

两条都给的时候，扫光跑在 `romaChars` 上——因为带罗马音时罗马音才是最大的那一行。

## 只要不返回就当没有

任何一个接口挂了、超时了、返回格式不对，前端只会跳过这一部分，
本地曲库的搜索和播放不受影响。
