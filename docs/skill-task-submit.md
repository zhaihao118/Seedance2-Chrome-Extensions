# Skill 描述：Seedance 视频生成任务提交

> **Skill ID**: `seedance-video-task-submit`  
> **版本**: v1.0  
> **协议**: HTTP REST API (JSON)  
> **服务端地址**: `http://localhost:3456` (Mock Server，可替换为生产地址)

---

## 概述

本 Skill 提供向 Seedance 视频生成流水线提交任务的能力。调用方通过 HTTP POST 推送任务后，Chrome 扩展客户端会通过 SSE 实时接收任务，并在即梦AI页面上自动完成以下流水线：

```
推送任务 → 配置参数 → 上传参考图+填写提示词 → 提交生成 → 等待完成 → 上传标清 → 提升分辨率 → 上传高清
```

---

## 接入方式

### 1. 推送任务（核心接口）

**POST** `/api/tasks/push`

#### 请求体 (JSON)

```json
{
  "prompt": "一个穿着红色连衣裙的女孩 (@图片1) 在舞台中央优雅地旋转跳舞",
  "description": "女孩跳舞测试视频",
  "modelConfig": {
    "model": "Seedance 2.0 Fast",
    "referenceMode": "全能参考",
    "aspectRatio": "16:9",
    "duration": "5s"
  },
  "referenceFiles": [
    "https://example.com/ref-image-1.jpg",
    "https://example.com/ref-image-2.png"
  ],
  "realSubmit": true,
  "priority": 1,
  "tags": ["portrait", "dance"]
}
```

#### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `prompt` | string | **是** | `""` | 视频生成提示词。支持 `(@图片N)` 语法引用参考图 |
| `description` | string | 否 | `""` | 任务描述（仅用于展示） |
| `modelConfig` | object | 否 | 见下方 | 模型配置参数 |
| `modelConfig.model` | string | 否 | `"Seedance 2.0 Fast"` | 模型选择 |
| `modelConfig.referenceMode` | string | 否 | `"全能参考"` | 参考模式 |
| `modelConfig.aspectRatio` | string | 否 | `"16:9"` | 画面比例 |
| `modelConfig.duration` | string | 否 | `"5s"` | 视频时长 |
| `referenceFiles` | string[] | 否 | `[]` | 参考图片 URL 列表 |
| `realSubmit` | boolean | 否 | `false` | `true`=真实提交生成, `false`=模拟模式（不点击生成按钮） |
| `priority` | number | 否 | `1` | 优先级 (数字越大越优先) |
| `tags` | string[] | 否 | `[]` | 任务标签（用于分类/筛选） |

#### 枚举值

**`modelConfig.model`**
| 值 | 说明 |
|----|------|
| `Seedance 2.0 Fast` | 快速模型（推荐） |
| `Seedance 2.0` | 标准模型（质量更高） |

**`modelConfig.referenceMode`**
| 值 | 说明 |
|----|------|
| `全能参考` | 综合参考（推荐） |
| `首尾帧` | 以参考图作为首帧和尾帧 |
| `主体参考` | 仅参考主体特征 |

**`modelConfig.aspectRatio`**
| 值 | 适用场景 |
|----|----------|
| `16:9` | 横屏视频（默认） |
| `9:16` | 竖屏/短视频 |
| `1:1` | 方形 |
| `4:3` | 传统比例 |
| `3:4` | 竖向传统 |
| `21:9` | 超宽屏 |
| `9:21` | 超长竖屏 |

**`modelConfig.duration`**
| 值 | 说明 |
|----|------|
| `4s` | 4 秒 |
| `5s` | 5 秒（默认） |
| `6s` \| `7s` \| `8s` \| `9s` \| `10s` | 6-10 秒 |

#### 成功响应

```json
{
  "success": true,
  "taskCodes": ["SD-20260216-0001"],
  "notified": 1
}
```

| 字段 | 说明 |
|------|------|
| `taskCodes` | 生成的任务编号数组 |
| `notified` | 已通知的 SSE 客户端数量。`0` 表示没有客户端在线 |

---

### 2. 批量推送

同一请求中可推送多个任务：

```json
{
  "tasks": [
    {
      "prompt": "第一个任务的提示词 (@图片1)",
      "referenceFiles": ["https://example.com/img1.jpg"],
      "realSubmit": true
    },
    {
      "prompt": "第二个任务的提示词 (@图片1)",
      "referenceFiles": ["https://example.com/img2.jpg"],
      "modelConfig": { "duration": "10s" },
      "realSubmit": true
    }
  ]
}
```

---

### 3. 提示词中的图片引用语法

提示词中使用 `(@图片名)` 引用 `referenceFiles` 中的图片。引用名称需与上传时的文件名匹配。

```
示例提示词: "一只可爱的猫咪 (@cat.jpg) 在草地上奔跑，阳光明媚"
```

上传多张参考图时，可按顺序使用 `(@图片1)` `(@图片2)` 等引用。

---

## 查询与追踪接口

### 4. 查询任务状态

**GET** `/api/tasks/pending?clientId={clientId}`

返回所有待处理任务。注意：调用此接口会自动占用返回的任务。

```json
{
  "success": true,
  "total": 2,
  "tasks": [
    {
      "taskCode": "SD-20260216-0001",
      "createdAt": "2026-02-16T10:00:00.000Z",
      "priority": 1,
      "status": "occupied",
      "prompt": "...",
      "modelConfig": { ... },
      "referenceFiles": [...],
      "realSubmit": true
    }
  ],
  "occupiedBy": "client-1"
}
```

### 5. 更新任务状态

**POST** `/api/tasks/status`

```json
{
  "taskCode": "SD-20260216-0001",
  "status": "completed",
  "completedAt": "2026-02-16T10:05:00.000Z"
}
```

#### 任务状态流转

```
pending → occupied → acked → configuring → generating → uploading → upscaling → uploading_hd → completed
                                                  ↘                                      ↗
                                                   → failed ──────────────────────────────
```

| 状态 | 含义 |
|------|------|
| `pending` | 待处理，等待客户端领取 |
| `occupied` | 已被客户端占用 |
| `acked` | 客户端已确认接收 |
| `configuring` | 正在配置模型参数 |
| `generating` | 已提交，等待视频生成完成 |
| `uploading` | 标清视频已完成，正在上传 |
| `upscaling` | 正在提升视频分辨率 |
| `uploading_hd` | 高清视频已完成，正在上传 |
| `completed` | 全流程完成 |
| `failed` | 生成失败 |

### 6. SSE 实时事件

**GET** `/api/events?clientId={clientId}`

建立 Server-Sent Events 长连接，实时接收以下事件：

| 事件类型 | 触发时机 | 数据 |
|----------|----------|------|
| `new-tasks` | 有新任务被推送 | `{ count, taskCodes, message, time }` |
| `task-status` | 任务状态变更 | `{ taskCode, status, error, time }` |
| `task-released` | 任务被释放 | `{ taskCode }` |
| `heartbeat` | 每 30 秒 | `{ time }` |

### 7. 查询上传的文件

**GET** `/api/files?taskCode={taskCode}`

查询任务关联的已上传文件（标清视频/高清视频/截图）。

```json
{
  "success": true,
  "total": 2,
  "files": [
    {
      "fileId": "F0001",
      "taskCode": "SD-20260216-0001",
      "quality": "standard",
      "filename": "SD-20260216-0001_standard_F0001.mp4",
      "mimeType": "video/mp4",
      "size": 1048576,
      "uploadedAt": "2026-02-16T10:04:30.000Z"
    },
    {
      "fileId": "F0002",
      "taskCode": "SD-20260216-0001",
      "quality": "hd",
      "filename": "SD-20260216-0001_hd_F0002.mp4",
      "mimeType": "video/mp4",
      "size": 4194304,
      "uploadedAt": "2026-02-16T10:06:00.000Z"
    }
  ]
}
```

### 8. 下载文件

**GET** `/uploads/{filename}`

直接访问上传的文件。

---

## 接入示例

### cURL

```bash
# 推送单个任务
curl -X POST http://localhost:3456/api/tasks/push \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一位少女在夕阳下的麦田中奔跑 (@girl.jpg) 金色光芒洒满大地",
    "referenceFiles": ["https://example.com/girl.jpg"],
    "modelConfig": {
      "model": "Seedance 2.0 Fast",
      "referenceMode": "全能参考",
      "aspectRatio": "16:9",
      "duration": "5s"
    },
    "realSubmit": true,
    "tags": ["portrait", "sunset"]
  }'

# 查询任务结果文件
curl http://localhost:3456/api/files?taskCode=SD-20260216-0001
```

### Python

```python
import requests

API_BASE = "http://localhost:3456"

# 推送任务
resp = requests.post(f"{API_BASE}/api/tasks/push", json={
    "prompt": "一位少女在夕阳下的麦田中奔跑 (@girl.jpg)",
    "referenceFiles": ["https://example.com/girl.jpg"],
    "modelConfig": {
        "model": "Seedance 2.0 Fast",
        "referenceMode": "全能参考",
        "aspectRatio": "16:9",
        "duration": "5s",
    },
    "realSubmit": True,
})
result = resp.json()
task_code = result["taskCodes"][0]
print(f"任务已推送: {task_code}")

# 轮询查询状态 (或使用 SSE)
import time
while True:
    files_resp = requests.get(f"{API_BASE}/api/files", params={"taskCode": task_code})
    files = files_resp.json().get("files", [])
    hd_files = [f for f in files if f["quality"] == "hd"]
    if hd_files:
        print(f"高清视频已就绪: {API_BASE}/uploads/{hd_files[0]['filename']}")
        break
    time.sleep(10)
```

### Node.js

```javascript
const fetch = require('node-fetch');
const EventSource = require('eventsource');

const API_BASE = 'http://localhost:3456';

// 1. 监听 SSE 事件
const es = new EventSource(`${API_BASE}/api/events?clientId=my-skill`);
es.addEventListener('task-status', (e) => {
  const data = JSON.parse(e.data);
  console.log(`任务 ${data.taskCode} 状态: ${data.status}`);
  if (data.status === 'completed') {
    // 查询生成的文件
    fetch(`${API_BASE}/api/files?taskCode=${data.taskCode}`)
      .then(r => r.json())
      .then(r => console.log('文件:', r.files));
  }
});

// 2. 推送任务
const resp = await fetch(`${API_BASE}/api/tasks/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '一位少女在夕阳下的麦田中奔跑 (@girl.jpg)',
    referenceFiles: ['https://example.com/girl.jpg'],
    modelConfig: {
      model: 'Seedance 2.0 Fast',
      referenceMode: '全能参考',
      aspectRatio: '16:9',
      duration: '5s',
    },
    realSubmit: true,
  }),
});
const result = await resp.json();
console.log('推送结果:', result.taskCodes);
```

---

## 注意事项

1. **`realSubmit: false`（默认）** — 模拟模式，仅配置页面参数但不点击生成按钮，适用于调试
2. **`realSubmit: true`** — 真实提交到即梦AI生成视频，会消耗算力额度
3. **`referenceFiles`** 中的图片 URL 必须可公网访问，客户端会下载后上传到即梦页面
4. **同一时间只有一个客户端**处理任务（通过 `occupiedBy` 防止重复执行）
5. **SSE 连接** 是推荐的事件接收方式，避免频繁轮询
6. 生成超时时间为 **10 分钟**，超时后任务会标记为 `failed`
7. 任务编号格式：`SD-{YYYYMMDD}-{序号}`，由服务端自动生成
8. 所有接口支持 **跨域 (CORS)**，可从浏览器直接调用

---

## 完整 API 汇总

| 方法 | 路径 | 说明 |
|------|------|------|
| **POST** | `/api/tasks/push` | 推送新任务（核心） |
| GET | `/api/tasks/pending?clientId=` | 获取待处理任务 |
| POST | `/api/tasks/ack` | 确认接收任务 |
| POST | `/api/tasks/status` | 更新任务状态 |
| GET | `/api/tasks/release?taskCode=` | 释放占用的任务 |
| GET | `/api/events?clientId=` | SSE 实时事件流 |
| GET | `/api/files?taskCode=` | 查询上传文件 |
| POST | `/api/files/upload` | 上传文件 (multipart) |
| GET | `/api/config` | 获取服务配置 |
| GET | `/uploads/{filename}` | 下载/预览文件 |
