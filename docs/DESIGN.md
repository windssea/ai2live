# AI Live2D Asset Compiler / Rigging Agent
## 从角色设定到可编辑 Live2D 工程的全自动 Agent 技术设计

**版本**：v0.1  
**日期**：2026-09-14  
**定位**：实施级技术设计 / Agent 产品蓝图  
**目标读者**：Agent/平台工程师、图像生成工程师、Live2D/PSD 工具开发者、模型师  

---

## 0. 文档目的

本文定义一套可由 Codex 或其他具备图像生成/编辑能力的 Agent 驱动的 **AI Live2D Asset Compiler / Rigging Agent**。它的目标不是“把一张图自动切成 PSD”，而是从角色创意或参考图开始，在有明确数据模型、质量闸门、历史恢复与下游适配的前提下，自动产出：

1. 角色设定与规范化 Master Illustration；
2. 可用于 Live2D 的语义图层计划与遮挡关系图；
3. 原像素优先、带隐藏区域补全的 RGBA 图层资产；
4. 表情/眼睛/嘴巴/附件差分素材；
5. 规范分层 PSD 与机器可读 Manifest；
6. 可选的 AutoLive2d 工程，或通过 psd2live 生成可继续编辑的 `.cmo3/.moc3`；
7. 自动姿态验证、视觉诊断、返修与可恢复历史。

本文同时分析两个现有项目：

- AutoLive2d：<https://github.com/Fenglin-Maple/AutoLive2d>
- psd2live：<https://github.com/tsunehimatoi/psd2live>

并明确哪些部分应直接复用、哪些应作为上下游适配器、哪些仅借鉴设计思想。

---

# 1. 执行摘要

## 1.1 核心判断

该方向技术上可行，而且比传统的：

```text
单张最终立绘 -> 自动分层/see-through -> PSD -> Rig
```

更合理的目标链路是：

```text
角色描述 / 参考图
      ↓
Character Spec
      ↓
Master Illustration
      ↓
Layer / Occlusion Manifest
      ↓
可见像素提取 + 隐藏区域补全 + 全角色差分
      ↓
RGBA Layer Package
      ↓
PSD Compiler
      ↓
AutoLive2d / psd2live
      ↓
Pose Grid Render
      ↓
视觉诊断 -> 局部返修 -> 再验证
      ↓
最终可编辑模型 + 资产来源 + 验收报告
```

核心优势是：**不再先把角色信息压扁成一张不可逆图片，再让另一个模型猜回其结构，而是在生成角色时就把“未来需要哪些可动层”纳入设计。**

## 1.2 产品定义

最终工具建议命名为：

> **AI Live2D Asset Compiler / Rigging Agent**

其本质是一个“面向 2D 可动角色的编译器 + Agent Runtime”，而非单个图像模型。

Agent 负责：

- 理解用户意图；
- 规划角色结构；
- 选择生成/编辑策略；
- 调用确定性工具；
- 审核图像结果；
- 发现失败并返修；
- 决定是否继续、回滚或降级。

程序负责：

- 坐标系、图层树、Z-order；
- PNG/Mask/PSD 操作；
- 内容寻址资产；
- Alpha、轮廓、重叠与拓扑检测；
- 历史/事务/并发；
- 与 AutoLive2d / psd2live 的适配；
- 固定姿态回归和可复现导出。

**LLM 不应逐像素或逐顶点“手搓”工程；LLM 应控制高层语义和策略，低层修改应尽可能确定性。** 这一原则与 psd2live 当前 Agent Design 的方向高度一致。[P4]

---

# 2. 对现有项目的分析

# 2.1 AutoLive2d

## 2.1.1 项目定位

AutoLive2d 是一个基于 React + TypeScript + WebGL/Canvas 的 Live2D-style 编辑器和运行时，支持 Electron。它把规范 PSD 转换为自研分层网格角色，支持面捕、伪 Z、头模投影、头发/衣物动态、附件、表情和运行时导出，但**不是 Cubism 模型导出器**。[A1]

这意味着它非常适合作为：

- 上游 PSD 是否“可动”的快速验证器；
- 自动图层生成算法的回归测试环境；
- 无需 Cubism SDK 的快速 Demo Runtime；
- 素材分层与追踪算法的参考实现。

## 2.1.2 已验证的关键经验

AutoLive2d 的 `u5/u6` 流程已经验证：

```text
游戏截图
 -> Codex / image generation 生成规范角色立绘
 -> see-through 拆 PSD
 -> AutoLive2d 自动导入/绑定
 -> 差分素材
 -> 摄像头驱动与验收
```

其文档特别强调：附件和表情不要优先生成“孤立的小眼睛/嘴巴图标”，而应先生成**与原角色完全对齐的全角色差分图**，再分层或裁取目标部分；否则容易出现眼距、透视、画风、位置不一致。[A3][A4]

这一点应直接变成本项目的生成硬规则。

## 2.1.3 可直接借鉴/引用的模块

### A. PSD 导入与语义修复思想

AutoLive2d 当前导入链：

- 使用 `ag-psd` 读取 PSD；
- 可见叶子层变成透明 PNG；
- 通过名称做语义分类；
- 对细小五官做 alpha crop；
- 对合并的双眼、瞳孔、睫毛、眉毛、双臂/双手做中心 Alpha 谷拆分；
- 自动分配 bounds、z-order、父级、Mesh、Pivot、Physics Template。[A5][A6]

新 Agent 可以借鉴这些语义修复规则，尤其适合处理用户提供的既有 PSD 或自动编译 PSD 的二次检查。

### B. `attachments.json` 伴随素材机制

AutoLive2d 的 `u6` 已支持 PSD 之外的透明 PNG 伴随层，并记录：

- bounds；
- kind；
- parent bone；
- z；
- physics；
- attachment metadata；
- expression `exclusiveGroup`；
- cloneOf / depth target 等。[A2][A4]

这几乎可以直接作为本项目 `LayerManifest` 的早期参考。

### C. 全角色差分生成规则

应直接吸收以下规则：

- 帽子、眼镜等先做完整角色差分，确定位置后再切；
- 表情优先生成完整角色版本；
- 嘴张开从完整张口角色提取；
- 眼睛差分需和原眼眶中心比对；
- 不能因为单个 PNG “看起来好看”就认为能拼回角色。[A2]

### D. 动态验证矩阵

AutoLive2d 已有固定验收项：

- neutral；
- 常见 expression；
- Head X/Y/Z min/max/neutral；
- Body X/Y/Z；
- Iris X/Y；
- Mouth Open；
- Arm Raise；
- Hair/accessory dynamics；
- manual depth / proxy-head 两种模式。[A7]

它还提供 `validate:ui` 脚本生成截图。新 Agent 可以复用这一“参数极限截图 + VLM 审核”的 QA 思路。

## 2.1.4 不建议直接继承为核心的部分

AutoLive2d 的规则网格、伪 Z、头模投影是它自研 Runtime 的设计，适合做快速验证，不应变成新 Asset Compiler 的唯一目标格式。

原因：

1. 最终用户若需要 Cubism 工程，仍需另一条链；
2. 图层资产生成应该与 Rig Runtime 解耦；
3. 未来可能加入 Inochi2D、其他 2D Puppet Runtime 或自定义游戏 Runtime。

因此 AutoLive2d 应被定义为 **Downstream Adapter A / Fast Validation Runtime**。

---

# 2.2 psd2live

## 2.2.1 项目定位

psd2live 是“规范分层 PSD -> 自动 Live2D Rig -> `.cmo3/.moc3`”的自动化桌面流水线。其 README 当前明确支持：

- PSD 图层语义识别；
- 连通域左右拆分；
- 自适应网格；
- 面部多轴变形；
- 物理；
- `.cmo3/.moc3` 导出；
- 本地 MCP Agent 工作区；
- 参数、K 帧、透明素材、历史树等编辑能力。[P1]

因此它天然适合成为本项目的 **Primary Downstream Rigging Backend**。

## 2.2.2 最值得复用的设计

### A. 31 类语义标签

psd2live 已定义 31 类核心语义，包括：

- `BACK_HAIR`, `FRONT_HAIR`；
- `FACE`, `FACE_DETAIL`；
- `IRIDES`, `EYEWHITE`, `EYELASH`, `EYE_CLOSE`；
- `EYEBROW`, `NOSE`；
- `MOUTH/MOUTH_OPEN`, `MOUTH_CLOSE`；
- `TOOTH_T`, `TOOTH_B`, `TONGUE`；
- `EARS`, `EYEWEAR`, `HEADWEAR`, `EARWEAR`；
- `NECK`, `TOPWEAR`, `HANDWEAR`, `BOTTOMWEAR`, `LEGWEAR`, `FOOTWEAR`；
- `TAIL`, `WINGS`, `OBJECTS` 等。[P2]

建议把这 31 类作为 `semantic` 字段的 **兼容基础集合**，在此之上允许扩展更细粒度的 `subtype`，例如：

```text
semantic = FRONT_HAIR
subtype = bang.center.01
```

这样既兼容 psd2live，又能满足更细的 Agent 拆层。

### B. 角色自身左右原则

psd2live 明确规定 LEFT/RIGHT 是角色自身左右，而不是观察者左右。[P2]

新工具必须从第一天就固定这个标准，避免 Agent、PSD、Runtime 之间左右翻转。

### C. “素材分离决定上限”

psd2live Agent Design 明确规定：不能只按可见轮廓切图，必须生成有合理重叠、遮挡补全的独立 RGBA；派生层要记录来源、mask/路径、生成设置和 prompt hash。[P4]

这是本项目最重要的架构原则之一，应直接采纳。

### D. View / Spatial Reference

psd2live 已经解决了 Agent 生图回填时非常容易踩的坑：**PNG 分辨率不等于画布空间尺寸**。

其 `asset_import_png` / `layer_add_from_asset` 设计使用：

- `spatial_reference_id`；
- `source_pixel_rect`；
- View -> Canvas 映射；
- 保持画布矩形；
- 严格拒绝静默拉伸；
- 裁透明边时仍保持正确画布位置。[P3]

这应原样抽象到本项目的资产协议中。

### E. 追加式历史树与并发 HEAD

psd2live 的工作区采用 append-only History Tree，写操作携带当前 `state`/HEAD；HEAD 不一致则返回 stale-head，避免 Agent 长任务覆盖用户或其他任务的新修改。[P3][P4]

新工具也应该采用：

```text
Immutable Asset + Append-only Revision + Workspace HEAD
```

而不是传统“直接覆盖文件”。

### F. 合并工具面

psd2live Agent Design 当前倾向把能力收敛成少量高层工具，例如：

- inspect
- view
- rig
- form
- parameter
- deform
- revision
- asset
- physics
- appearance

而不是给 Agent 暴露几十个同义 API。[P4]

新工具同样应该保持 MCP Tool 数量少、action 字段明确。

## 2.2.3 当前边界

psd2live 当前 README 对 Agent 能力有明确提醒：简单附件加入已经可用，但复杂图层拆分、表情/动作差分、口腔拆分、头发拆分和遮挡补全等仍被标记为待实现或端到端不稳定。[P1]

因此本项目不能假设“把图片交给 psd2live MCP，它会自动解决全部上游素材问题”。

正确边界应是：

> **本项目负责把“角色视觉素材”编译成高质量、语义完整的分层资产；psd2live 负责 Rig、Deformer、参数、物理和 Cubism 输出。**

---

# 2.3 两个项目的角色分工

| 能力 | 新 Agent | AutoLive2d | psd2live |
|---|---|---|---|
| 角色设定生成 | 主责 | 可提供经验 | 非主责 |
| Master Illustration | 主责 | 已验证 image workflow | 非主责 |
| 语义 Layer Plan | 主责 | 可借鉴 classify | 31 标签可作标准 |
| 可见像素分离 | 主责 | see-through 可作 fallback | 规划中 |
| 遮挡补全 | 主责 | workflow 经验 | 规划中/部分工具基础 |
| 差分生成 | 主责 | u6 经验可复用 | 仍不稳定 |
| PSD 生成 | 主责 | 可读取 | 规划有 writer/import manifest |
| 快速 Rig 预览 | 可选 | 主力 | 可做 |
| Cubism `.cmo3/.moc3` | 不自己重造 | 不支持 | 主力 |
| MCP 工作区 | Agent Runtime 自己提供 | 暂不依赖 | 已有，可作为下游 |
| 历史恢复 | 主责 | 工程/模板导出 | 已有优秀参考 |
| 姿态 QA | 主责 | 适合快速跑 | 适合最终 Cubism QA |

推荐：

```text
             ┌─────────────────────────────┐
             │ AI Live2D Asset Compiler   │
             │  Spec / Layers / Assets    │
             │  PSD / Manifest / QA       │
             └─────────────┬───────────────┘
                           │
             ┌─────────────┴──────────────┐
             │                            │
       AutoLive2d Adapter           psd2live Adapter
       快速验证/面捕 Demo            正式 Rig/Cubism 输出
             │                            │
      Runtime/截图回归              CMO3/MOC3/姿态回归
             └─────────────┬──────────────┘
                           │
                    Agent Repair Loop
```

---

# 3. 总体设计原则

## 3.1 原像素优先，而不是重新画所有部件

基础公式：

```text
Final Layer = Visible Pixels from Master + Generated Hidden Completion
```

而不是：

```text
Final Layer = Generate the whole part again from prompt
```

如果目标像素已经存在于 Master，就直接复制它，只有不可见区域才生成。

这显著降低：

- Identity drift；
- 线稿变化；
- 色差；
- 阴影方向变化；
- 眼距/脸型漂移；
- 服装纹理重绘。

## 3.2 全角色差分优先于孤立部件生成

需要新表情或显露隐藏区域时，默认策略是生成/编辑一张**完整角色差分**：

- `neutral.png`
- `mouth_open.png`
- `eye_closed.png`
- `smile.png`
- `no_front_hair.png`
- `no_hat.png`
- `no_glasses.png`
- `arm_separated.png`

随后从对齐差分中提取目标层。

这与 AutoLive2d 的 u6 经验一致。[A2][A4]

## 3.3 Rigability-first

角色生成 Prompt 不应只优化“单张立绘好看”，而应同时满足：

- 正面或近正面；
- 低透视；
- 躯干基本正立；
- 左右结构清晰；
- 手臂不要交叉挡住胸口；
- 五官位置稳定；
- 长发可以拆成自然发束；
- 饰品可被分成前/后层；
- 口部能生成最大张口差分；
- 眼白、瞳孔、上睫毛可分离。

## 3.4 Agent 负责策略，确定性程序负责几何

Agent 不直接做：

- 逐像素坐标搬运；
- 大量顶点编号操作；
- 随机修改 PSD 二进制；
- 靠 prompt 记住坐标。

程序提供：

- crop/mask/alpha compositing；
- dilation/erosion/feather；
- source pixel mapping；
- bounding box；
- connected component；
- seam detection；
- transform；
- PSD serialization；
- pose screenshot generation。

## 3.5 每一步必须可恢复

任何生成/修改都必须产生 revision，不原地覆盖唯一真相。

---

# 4. 领域模型

推荐工作区模型：

```text
Project
├── ProjectSpec
├── CharacterSpec
├── SourceDocument[]
│   ├── UserReference
│   ├── MasterIllustration
│   └── DifferentialMaster
├── LayerPlan
│   ├── LayerNode[]
│   ├── OcclusionEdge[]
│   └── RigHint[]
├── AssetRevision[]
│   ├── RGBA
│   ├── Mask
│   ├── HiddenCompletion
│   └── CompositePreview
├── PSDArtifact[]
├── DownstreamBuild[]
├── ValidationRun[]
├── Task[]
└── HistoryTree
```

## 4.1 所有对象使用稳定 UUID

图层显示名可以改，但引用不能靠名字。

```json
{
  "id": "layer_01J...",
  "display_name": "front_hair_center_01",
  "semantic": "FRONT_HAIR",
  "side": "CENTER"
}
```

## 4.2 内容寻址资产

所有 PNG/PSD/JSON 计算 SHA-256：

```text
assets/sha256/ab/cd/abcdef....png
```

历史节点只引用 hash，不复制大文件。

这可借鉴 psd2live `.psd2live` 工程的 manifest + SHA-256 inventory 思路。[P5]

## 4.3 坐标体系

必须同时保留三种坐标：

1. **Canvas normalized**：`x,y ∈ [0,1]`，适合跨分辨率；
2. **Canvas pixel**：Master 的像素坐标；
3. **Source pixel rect**：某次图像生成/编辑输出对应的源视图区域。

任何生图输出都必须携带 Spatial Reference：

```json
{
  "spatial_reference_id": "view_abc",
  "view_rect_canvas": [0.18, 0.05, 0.64, 0.52],
  "source_pixel_rect": [0, 0, 1536, 1536],
  "output_size": [2048, 2048]
}
```

输出变成 2048×2048 不代表它在角色画布中变大。

---

# 5. Layer Manifest v0.1

这是整个项目最重要的数据协议。

## 5.1 图层节点字段

```json
{
  "id": "layer_front_hair_l_01",
  "display_name": "front_hair_l_01",
  "semantic": "FRONT_HAIR",
  "subtype": "bang.left.01",
  "side": "LEFT",
  "parent": "layer_head_root",
  "z_index": 620,
  "canvas_bounds": {
    "x": 0.31,
    "y": 0.08,
    "w": 0.18,
    "h": 0.34
  },
  "pivot_hint": [0.39, 0.12],
  "motion_owner_hint": "HEAD",
  "physics_hint": "HAIR_SHORT",
  "source": {
    "type": "master_plus_completion",
    "master_asset_id": "asset_master_neutral",
    "visible_mask_id": "mask_hair_l_visible",
    "completion_asset_id": "asset_hair_l_hidden_v2"
  },
  "overlap": {
    "required_with": ["layer_face"],
    "minimum_px_at_master_resolution": 12
  },
  "provenance": {
    "generator": "image-edit-provider-x",
    "prompt_hash": "sha256:...",
    "seed": null,
    "created_revision": "rev_014"
  },
  "status": "VALIDATED"
}
```

## 5.2 Side 枚举

```text
LEFT / RIGHT / CENTER / BOTH / NONE
```

其中 LEFT/RIGHT 使用 **角色自身左右**，兼容 psd2live。[P2]

## 5.3 Source Type

```text
master_pixels
master_plus_completion
full_character_differential
generated_standalone
clone
user_asset
fallback_separator
```

`generated_standalone` 应是低优先级策略，必须额外提高 QA 门槛。

---

# 6. Occlusion Graph

单纯 Layer Tree 不足以描述角色。

需要额外定义遮挡边：

```text
front_hair  --occludes--> face
face        --occludes--> back_hair
headwear_front --occludes--> front_hair
front_hair  --occludes--> eyebrow
upper_lash  --occludes--> iris
upper_lip   --occludes--> mouth_cavity
body/topwear --occludes--> arm_root
```

每条边至少包含：

```json
{
  "front": "layer_front_hair",
  "back": "layer_face",
  "region_mask": "mask_overlap_123",
  "motion_risk": "HIGH",
  "completion_required": true,
  "recommended_margin_px": 16
}
```

## 6.1 为什么 Occlusion Graph 必须是一等数据

它用于：

- 判断哪些图层需要隐藏区域补全；
- 决定哪个完整差分需要生成；
- 自动安排 Z-order；
- 生成运动测试；
- 预测露洞风险；
- 返修时定位“应该补前层还是后层”。

---

# 7. 完整 Agent 工作流

# 7.1 Phase A：需求解析与 Character Spec

输入可以是：

- 纯文本；
- 一张角色参考；
- 多张参考；
- 现有立绘；
- 已有 PSD。

输出 `character_spec.json`：

```json
{
  "style": "anime_cel_clean",
  "body_crop": "upper_body",
  "pose": "front_relaxed_t_pose",
  "hair": {...},
  "eyes": {...},
  "outfit": {...},
  "accessories": [...],
  "target_backends": ["psd2live", "autolive2d"],
  "quality_tier": "production"
}
```

Agent 在这里就要做 Rig 风险评估：

- 长刘海过度遮脸？
- 大帽子会否挡住头顶？
- 手臂是否跨胸？
- 巨型披风是否需要多层？
- 高度不对称发型是否需要更多物理层？

# 7.2 Phase B：生成 Master Illustration

推荐标准：

- 透明或纯色易去底背景；
- 正面 / 轻微自然歪头；
- 身体基本正立；
- 肩膀展开；
- 双手避免遮挡脸和胸部；
- 光源简单；
- 线稿稳定；
- 不使用强景深；
- 少量明确高光，不堆复杂半透明特效。

Master 是整个项目的视觉真相。后续生成必须以它作为图像参考，而不是只引用文字 Prompt。

# 7.3 Phase C：语义规划

Agent 读取 Master，生成：

1. `LayerPlan`；
2. `OcclusionGraph`；
3. `DifferentialPlan`；
4. `RigHintPlan`。

最低标准层集建议以 psd2live 31 semantic tags 为基础。[P2]

但实际生成时应该更细，例如：

```text
BACK_HAIR
  back_hair_mass
  ponytail_l
  ponytail_r

FRONT_HAIR
  bang_center_01
  bang_left_01
  bang_right_01
  side_hair_l
  side_hair_r

FACE
  face_base
  ear_l
  ear_r

EYES
  eyewhite_l/r
  iris_l/r
  upper_lash_l/r
  eye_close_l/r (optional)

MOUTH
  mouth_open_base
  tooth_t
  tooth_b
  tongue
```

# 7.4 Phase D：Mask Proposal

对每个 layer：

1. 先从 Master 做分割/Mask；
2. 对可见像素建立 `visible_mask`；
3. 对被遮挡的预期完整形状建立 `completion_region`；
4. 扩大 overlap margin。

see-through 可以在此作为：

- 自动 Mask proposal；
- 当 segmentation 不稳定时的 fallback；
- 对用户已有单图的初始拆层器。

但它不再是唯一主流程。

# 7.5 Phase E：Reveal Differential

对于关键遮挡，不应立即“凭空补画”。优先生成“去掉遮挡物的完整角色差分”。

例如：

```text
Master: 有刘海
Reveal: no_front_hair
=> 提取完整额头/眉毛/脸部

Master: 戴眼镜
Reveal: no_glasses
=> 提取完整眼睛/眉毛

Master: 戴帽子
Reveal: no_hat
=> 提取完整头顶和发根
```

要求：

- 画布不变；
- 姿势不变；
- 五官不变；
- 光照不变；
- 只有指定遮挡物被删除/改变。

# 7.6 Phase F：Occlusion Completion

如果 Reveal Differential 仍不足，再做局部补全。

补全输入：

- Master crop；
- 上下文 crop；
- visible mask；
- completion mask；
- 相邻图层轮廓；
- 角色风格 spec；
- 目标 layer 语义。

输出必须经过：

1. 边缘颜色检查；
2. 线宽一致性；
3. 与可见像素接缝检查；
4. overlap 检查；
5. composite preview。

# 7.7 Phase G：Expression / Mouth / Eye Differential

采用完整角色差分：

```text
neutral
mouth_open_max
eye_closed
smile
angry
surprised
heart_eye (optional)
```

然后提取：

- eye close；
- mouth open；
- oral cavity；
- blush / face overlay；
- 特殊瞳孔。

尤其是 psd2live 更偏好最大张口素材，并把闭口作为参数压缩目标；Agent 可以针对该 backend 生成 `mouth_open_max`。[P1][P2]

# 7.8 Phase H：Layer Assembly

Layer Compiler 将：

- 原 Master 可见像素；
- reveal differential；
- inpaint completion；
- masks；
- clone/filler；

组合成每个最终 RGBA。

不得在这一阶段自由重绘整层。

# 7.9 Phase I：Static Composite QA

把所有最终层按 Z-order 重新合成成 neutral。

必须比较：

```text
recomposed_neutral vs master_neutral
```

可见区域预期应非常接近。

# 7.10 Phase J：PSD Compile

生成标准：

- RGB / 8-bit；
- 透明背景；
- pixel layer/group；
- 不依赖文字/矢量/智能对象；
- 名称清晰；
- Layer order 固定；
- PSD flatten preview 与 Agent composite 一致；
- 同时输出 manifest。

可选实现：

- TypeScript：`ag-psd`，其公开 API 支持 `writePsd`/`writePsdBuffer`；[T1]
- Python：`psd-tools` 支持低层 PSD/PSB 读写和基本 pixel layer/group 修改，但高层效果编辑支持有限。[T2]

由于目标 PSD 只需要“像素层 + 分组”，两者均可满足，建议优先沿用 AutoLive2d 已使用的 `ag-psd`，减少跨语言数据差异。[A5]

# 7.11 Phase K：Downstream Rig

## AutoLive2d 路线

```text
PSD
 -> AutoLive2d import
 -> semantic repair
 -> default mesh/deformer/physics
 -> validation screenshots
```

用途：快速评估分层是否“能动”。

## psd2live 路线

```text
PSD
 -> psd2live
 -> semantic / mesh / deformer
 -> parameters / physics
 -> cmo3/moc3
 -> model view validation
```

用途：正式 Cubism 输出。

# 7.12 Phase L：Pose Grid QA

最少测试：

```text
Neutral
HeadX: -30, 0, +30
HeadY: -20, 0, +20
HeadZ: -15, 0, +15
EyeOpen: 0, 1
IrisX/Y: min/max
MouthOpen: 0, 0.5, 1
BodyX/Y/Z: min/neutral/max
HairPhysics: left/right impulse
AccessoryPhysics
ArmRaise if available
```

对高质量 Tier 再加组合角：

```text
HeadX/HeadY = (-30,-20), (-30,+20), (+30,-20), (+30,+20)
```

# 7.13 Phase M：Agent Repair Loop

视觉模型审查截图，输出缺陷类型：

```text
HOLE
SEAM
WRONG_Z
STYLE_DRIFT
POSITION_DRIFT
EDGE_DIRT
HAIR_ROOT_DETACH
NECK_GAP
EYE_ESCAPE
MOUTH_DRIFT
OVERLAP_EXCESS
PHYSICS_TEAR
```

再映射到修复动作：

```text
HOLE -> back layer completion / overlap expansion
SEAM -> feather/blend or regenerate hidden completion
STYLE_DRIFT -> preserve visible pixels; replace generated region only
POSITION_DRIFT -> spatial registration correction
WRONG_Z -> manifest z correction
EYE_ESCAPE -> mask/rig hint correction
MOUTH_DRIFT -> bounds/pivot correction
```

---

# 8. Agent Runtime 与 MCP Tool 设计

不建议暴露几十个 Tool。建议 10 个领域 Tool，每个 Tool 用 `action` 区分子动作。

## 8.1 `inspect`

用途：读取项目摘要、Layer Graph、某个 Asset/Layer/Task。

```json
{"scope":"project"}
{"scope":"layer","id":"layer_x"}
{"scope":"query","semantic":"FRONT_HAIR"}
```

## 8.2 `design`

用途：生成或更新角色设计计划。

Actions：

```text
create_spec
plan_layers
plan_differentials
plan_occlusion
```

## 8.3 `view`

用途：给 Agent 看干净、可逆映射的图，而不是 UI 截图。

Actions：

```text
master
layer
context
mask_overlay
composite
pose_grid
compare
```

返回 `spatial_reference_id`。

## 8.4 `asset`

Actions：

```text
import
register
extract_pixels
apply_mask
inpaint
remove_background
reprocess
```

所有素材都保留来源。

## 8.5 `layer`

Actions：

```text
create
update_semantic
set_parent
set_z
set_bounds
replace_asset
soft_delete
```

## 8.6 `compose`

Actions：

```text
preview
build_layer_package
build_psd
build_manifest
```

## 8.7 `downstream`

Actions：

```text
autolive2d_import
autolive2d_validate
psd2live_import
psd2live_build
psd2live_export
```

psd2live 优先通过独立 MCP/CLI 连接，不直接耦合内部代码。

## 8.8 `validate`

Actions：

```text
static
alpha
alignment
overlap
style
pose_grid
backend
full
```

## 8.9 `revision`

Actions：

```text
list
checkout
diff
commit_candidate
```

## 8.10 `task`

Actions：

```text
start
update
get
list
```

长任务以 checkpoint 保存，不让一次 MCP 调用跑几十分钟。

---

# 9. Agent Workflow Registry

建议内建以下 Workflow，不写成一个巨型 System Prompt：

```text
character-design
rigability-audit
layer-planning
semantic-labeling
mask-extraction
face-reveal
hair-separation
mouth-construction
eye-construction
accessory-split
occlusion-completion
psd-build
static-qc
autolive2d-qc
psd2live-qc
repair-loop
final-export
```

每个 workflow 文件必须声明：

- 输入；
- 必须读取的数据；
- 推荐策略；
- 禁止动作；
- Tool 调用顺序；
- 质量阈值；
- 重试次数；
- 失败/降级条件；
- 产物。

---

# 10. Quality Gates

# 10.1 Gate 0：Master 可绑定性

失败条件：

- 身体过度侧躺；
- 双臂严重交叉；
- 大面积物件挡脸；
- 过强透视；
- 角色主体被裁掉；
- 关键部件左右不可判断。

如果失败，优先重新生成 Master，而不是继续拆层。

# 10.2 Gate 1：Layer Plan 完整性

要求：

- 所有关键 semantic 都有映射；
- 关键左右层明确；
- Occlusion Graph 无明显矛盾；
- 关键运动部件不被合并成一个不可分大层。

# 10.3 Gate 2：Visible Pixel Fidelity

指标：

```text
visible_pixel_reuse_ratio >= 0.95  （基础层目标）
```

对于无需隐藏补全的 layer，应接近 1.0。

# 10.4 Gate 3：Composite Fidelity

只在 Master 中真实可见区域比较：

- Alpha mismatch；
- RGB difference；
- edge mismatch；
- landmark shift。

建议记录：

```text
MAE / PSNR / SSIM / edge IoU
```

这些指标不是最终审美，但能快速发现“某层位置错了 10px”这类确定性失败。

# 10.5 Gate 4：Overlap Sufficiency

移动边界处必须有隐藏余量。

初版可以定义经验范围：

- face under front hair：Master 2048 分辨率下 12-32 px；
- neck under face/chin：16-40 px；
- arm under sleeve/body：16-48 px；
- long hair segments：24-64 px。

实际应按预计运动幅度换算，不应永久硬编码固定像素。

# 10.6 Gate 5：Generated Region Consistency

只评估生成区域：

- 色相/明度与邻近原像素差异；
- 线稿宽度；
- 纹理频率；
- 边缘方向连续性；
- 是否出现重复眼睛/文字/伪影。

# 10.7 Gate 6：PSD Round-trip

必须验证：

```text
RGBA package -> PSD -> read PSD again -> flatten
```

read-back 后：

- layer count 相同；
- stable ID 可从 manifest 对应；
- flatten 与 compose preview 一致；
- 无意外背景；
- 无 Alpha 污染。

# 10.8 Gate 7：Rig Extreme Pose

参考 AutoLive2d 的固定极限姿态检查。[A7]

最终允许视觉 Agent 判定：

- 是否露洞；
- 是否穿插；
- 是否头发根部分离；
- 眼睛是否跑出眼眶；
- 嘴是否上下漂；
- neck/body 是否断开；
- 饰品是否漂移。

# 10.9 Gate 8：最终可编辑性

不能只看最终视频。

必须确认：

- 源 RGBA 仍在；
- layer provenance 仍在；
- PSD 可打开；
- downstream model 可编辑；
- 任一自动修改可以回溯到 revision；
- 自动修复没有把所有内容烘焙成不可逆单层。

---

# 11. 重试与停止策略

自动化 Agent 最危险的问题之一是无限重试图像生成。

建议：

```text
单 Asset 生成尝试：最多 3 次
单 Layer 修复循环：最多 2 轮
全工程 Repair Loop：默认最多 3 轮
高成本 full-character differential：默认最多 2 次/类型
```

超过预算后：

1. 退回最后通过 Gate 的 revision；
2. 标记该 layer 为 `NEEDS_REVIEW`；
3. 输出具体失败原因；
4. 允许用户替换一个 PNG 后继续自动化。

Agent 必须能说“这个部件不能可靠自动完成”，而不是为了“完成任务”生成低质量素材。

---

# 12. AutoLive2d Adapter 详细设计

## 12.1 推荐复用

可借鉴甚至在许可证允许下直接复用：

- `src/lib/psdImport.ts` 的 PSD 解析思想；
- `src/lib/classify.ts` 语义名称兼容规则；
- paired alpha-valley split；
- z-order 推荐；
- attachment manifest 思想；
- `validate:ui` 的参数截图回归方法；
- u5/u6 full-character differential 工作流。[A2][A4][A5][A6][A7]

## 12.2 建议新增 Adapter

不要让 Agent 点击 AutoLive2d UI 完成所有步骤。

增加独立 runner：

```text
packages/autolive2d-adapter/
  import_psd.ts
  build_project.ts
  set_parameters.ts
  render_snapshot.ts
  run_validation_grid.ts
```

输出：

```json
{
  "backend": "autolive2d",
  "build_id": "...",
  "screenshots": [...],
  "warnings": [...],
  "unknown_layers": []
}
```

## 12.3 定位

AutoLive2d 在本系统中不是最终标准，而是：

> **快速、开源、可调试的 Layer/Rig Sanity Backend。**

---

# 13. psd2live Adapter 详细设计

## 13.1 推荐模式

首选：

```text
Agent Runtime
   ↓ MCP/CLI
psd2live 独立进程
```

这样可以：

- 避免复制其 GPL 代码到主工程；
- 保持更新边界；
- 直接利用其当前 MCP/历史/模型导出能力；
- 将来替换版本更容易。

## 13.2 可以直接使用的能力

当前可利用的基础概念/接口包括：

- Project/Layer/Parameter inspection；
- View；
- `asset_import_png`；
- `layer_add_from_asset`；
- `layer_soft_delete`；
- 参数 CRUD；
- keyform 操作；
- 历史树；
- task checkpoint；
- Cubism 输出。[P3]

不过对于“从零生成整个 PSD”，新 Agent v0.1 应优先在外部完成 PSD Compiler，然后把完整 PSD 交给 psd2live；不要把大量 upstream 图像合成逻辑强塞进 psd2live。

## 13.3 后续深度集成

未来可让新 Agent 跳过中间 PSD 的一部分步骤：

```text
RGBA Layer Package
 -> psd2live MCP assets
 -> layer graph
 -> rig
```

但 PSD 仍建议保留为：

- 人类交付格式；
- 审核格式；
- 跨工具交换格式；
- 归档格式。

---

# 14. PSD Compiler 设计

## 14.1 输出目录

```text
project/
├── spec/
│   ├── character.json
│   ├── layer_manifest.json
│   └── occlusion_graph.json
├── design/
│   ├── master_neutral.png
│   └── differentials/
├── masks/
├── layers/
│   ├── face.png
│   ├── front_hair_l_01.png
│   ├── front_hair_r_01.png
│   └── ...
├── previews/
│   ├── recomposed_neutral.png
│   └── layer_debug_sheet.png
├── psd/
│   ├── character.psd
│   └── import_manifest.json
├── builds/
│   ├── autolive2d/
│   └── psd2live/
└── validation/
    ├── report.json
    ├── pose_grid/
    └── failures/
```

## 14.2 PSD Group 建议

```text
[ACCESSORY_FRONT]
[FRONT_HAIR]
[FACE_DETAIL]
[EYES]
[FACE]
[ACCESSORY_MID]
[NECK]
[BODY]
[ARMS]
[BACK_HAIR]
[ACCESSORY_BACK]
```

其中组仅为组织便利；最终 semantic 仍以 Manifest 为真相。

## 14.3 命名规范

推荐：

```text
<semantic>_<side>_<index>__<short-id>
```

例如：

```text
front_hair_l_01__a91f
iris_r_01__c18e
mouth_open_c_01__4d22
```

不要把完整 UUID 放在显示名中，但 import manifest 必须保存 UUID。

---

# 15. 视觉生成策略

## 15.1 Prompt 分层

Prompt 不应该一个巨大字符串承担全部约束。

拆为：

```text
Identity Prompt
Art Style Prompt
Rigability Prompt
Pose/Composition Prompt
Edit Delta Prompt
Negative Constraints
```

## 15.2 Edit Delta Prompt

例如“去刘海”不是：

> 重新画一个没有刘海的角色。

而应该是：

> 保持角色身份、脸型、眼距、头部角度、姿势、身体、衣服、背景、线稿和光照完全不变；仅移除前刘海，并自然补全此前被遮挡的额头、眉毛和发际线。禁止改变眼睛、鼻子、嘴巴和脸轮廓。

## 15.3 生成区域最小化

Mask 应尽可能只覆盖需要补全的隐藏区域和过渡带。

如果整个脸都被重新生成，即使肉眼相似，也会降低后续图层复合稳定性。

---

# 16. 自动视觉诊断

建议每个 screenshot 同时跑：

## 16.1 Deterministic CV

适合判断：

- alpha hole；
- seam；
- pixel mismatch；
- layer bounds；
- component count；
- obvious edge dirt；
- unexpected opaque background。

## 16.2 Vision Model

适合判断：

- 发束是否自然；
- 补全是否像同一个角色；
- 转头是否“脸裂了”；
- 眼睛是否漂；
- 遮挡关系是否不自然；
- 物理效果是否像橡皮/纸片。

## 16.3 双裁决

只有 CV 通过 + Vision Review 通过，才能进入 `VALIDATED`。

---

# 17. 状态机

```text
NEW
 ↓
SPEC_READY
 ↓
MASTER_READY
 ↓
LAYER_PLAN_READY
 ↓
ASSET_GENERATING
 ↓
STATIC_QC
 ├── fail -> REPAIRING -> STATIC_QC
 ↓ pass
PSD_READY
 ↓
RIG_BUILDING
 ↓
POSE_QC
 ├── fail -> REPAIRING -> rebuild
 ↓ pass
READY_FOR_EXPORT
```

任何一步都可以：

```text
-> NEEDS_REVIEW
-> FAILED
-> CANCELLED
```

---

# 18. Revision / Transaction 设计

借鉴 psd2live：

```text
History Tree (append-only)
```

每个写操作：

```json
{
  "expected_head": "rev_015",
  "action": "replace_layer_asset",
  "target": "layer_front_hair_l_01"
}
```

若 HEAD 已变化：

```text
STALE_HEAD
```

Agent 必须刷新，不得盲重试。

长操作先生成 candidate revision，验证通过才提交为 workspace HEAD。

---

# 19. Evals / 测试集

最终产品不能只依靠几个成功 Demo。

建立至少四类数据集：

## 19.1 Synthetic Clean Set

专门设计为容易拆层的标准角色，用于回归基础能力。

## 19.2 Hair Stress Set

包括：

- 多束刘海；
- 双马尾；
- 长侧发；
- 头饰穿插；
- 渐变发色。

## 19.3 Occlusion Stress Set

包括：

- 眼镜；
- 帽子；
- 面纱；
- 衣领挡脖子；
- 袖子挡手臂根部。

## 19.4 Existing Flat Image Set

用于测试 fallback：用户只有最终成图，没有生成过程。

指标：

```text
Layer Plan Accuracy
Semantic Accuracy
Static Composite Error
Pose Failure Rate
Average Repair Loops
Image Generation Count
Token/Cost
Human Fix Time
Final Pass Rate
```

真正重要的业务指标：

> **模型师把自动结果修到可交付所需要的时间，是否显著低于从头制作。**

---

# 20. 技术栈建议

## 20.1 Orchestrator / MCP

推荐 TypeScript / Node.js：

- 与 Codex/MCP 生态衔接自然；
- AutoLive2d 同栈；
- `ag-psd` 可直接使用；
- 适合本地桌面/CLI/服务三种形态。

## 20.2 Image Worker

Python 服务：

- Pillow；
- OpenCV；
- NumPy；
- 可选 segmentation / inpainting provider；
- 统一处理 mask、morphology、alpha、CV metrics。

## 20.3 Storage

```text
SQLite: metadata/history/task
Filesystem: content-addressed assets
JSON: portable manifests
```

## 20.4 UI

v0.1 可完全 CLI + Web Report。

v1 再加入：

- 对话区；
- Layer Graph；
- Before/After；
- History Tree；
- Pose Grid；
- Failed Layer 手动替换。

---

# 21. 推荐仓库结构

```text
live2d-agent/
├── apps/
│   ├── cli/
│   ├── mcp-server/
│   └── studio/                 # v1
├── packages/
│   ├── domain/
│   ├── manifest-schema/
│   ├── history/
│   ├── agent-runtime/
│   ├── workflow-registry/
│   ├── image-client/
│   ├── psd-compiler/
│   ├── qc-engine/
│   ├── autolive2d-adapter/
│   └── psd2live-adapter/
├── services/
│   └── image-worker-python/
├── workflows/
│   ├── hair-separation.md
│   ├── face-reveal.md
│   ├── mouth-construction.md
│   └── ...
├── schemas/
│   ├── character.schema.json
│   ├── layer-manifest.schema.json
│   └── validation.schema.json
├── evals/
└── examples/
```

---

# 22. MVP 实施顺序

## M0：确定性 Layer Package

目标：不接图像生成，先手工提供 PNG，验证：

```text
LayerManifest -> PSD -> AutoLive2d / psd2live
```

完成标准：

- manifest/schema；
- stable IDs；
- spatial reference；
- PSD writer；
- round-trip QA；
- 两个 backend adapter 至少能导入。

## M1：Master -> Mask -> PSD

加入自动 segmentation / see-through fallback。

仍不生成隐藏区。

目的：建立 CV/QC 与错误定位。

## M2：Occlusion Completion

只做三个高价值场景：

1. 刘海下的脸；
2. 脸后的后发；
3. 衣服/身体下的手臂根部。

完成后即可验证“新路线是否优于纯 see-through”。

## M3：Expression Differential

加入：

- mouth open；
- eye close；
- smile；
- 一类特殊眼睛。

## M4：Agent Repair Loop

加入 pose grid、截图诊断、自动返修。

这是从“流水线脚本”变成“Agent”的关键阶段。

## M5：psd2live 深度集成

自动：

- 导入；
- build；
- 参数姿态截图；
- 导出 cmo3/moc3；
- report。

## M6：完整无人值守产品

加入：

- cost budget；
- retry policy；
- history UI；
- human handoff；
- eval dashboard；
- 多 provider。

---

# 23. 第一版推荐范围

不要一开始支持：

- 全身复杂动作；
- 手指级别；
- 巨型翅膀；
- 多人同框；
- 半透明复杂特效；
- 极端侧脸；
- 厚涂无边界角色；
- 复杂武器遮身。

v0.1 推荐限制：

```text
二次元 / clean anime
上半身
正面
1 人
中等复杂发型
无或少量头饰
基本嘴眼表情
```

先把成功率做到稳定，再扩大风格和构图。

---

# 24. 与纯 see-through 基线的 A/B 实验

必须做一个明确实验验证新方案价值。

同一个 Master：

## Baseline A

```text
Master -> see-through -> PSD -> Rig
```

## Proposed B

```text
Master
 -> Layer Plan
 -> Mask + Visible Pixel Preservation
 -> Occlusion Completion
 -> Differential Extraction
 -> PSD
 -> Rig
```

比较：

- neutral 重组误差；
- HeadX/Y 极限露洞数量；
- hair seam；
- face/hair 分离；
- mouth/eye 对齐；
- 人工修复分钟数；
- Agent 总生图次数。

如果 B 不能显著降低人工修复，就不应继续扩大 Agent 复杂度。

---

# 25. 许可证与项目边界

## 25.1 AutoLive2d

仓库主代码为 Apache License 2.0。[A8]

但它明确提示：

- bundled see-through 上游也是 Apache-2.0；
- see-through 下载的模型权重有各自 model card/license；
- `public/samples` 和文档参考图不自动随主仓库 Apache-2.0 授权。[A9]

因此可借鉴/复用代码时要保留 NOTICE/Attribution；不要把样例角色素材当成自由商用素材。

## 25.2 psd2live

仓库为 GPL-3.0。[P6]

如果希望新 Agent 保持不同许可证或闭源发行，推荐：

> **把 psd2live 当独立程序，通过 MCP/CLI/文件协议交互，而不是复制其 GPL 实现进入同一代码库。**

如果新项目本身选择 GPL-compatible 分发，则可再评估更深源码复用。

本节只提供工程边界建议，不构成法律意见。

---

# 26. 最终验收定义（Definition of Done）

一份“完整自动化 Agent 工具”至少满足：

```text
[ ] 用户能用文本或参考图创建项目
[ ] Agent 能产生 Rig-friendly Master
[ ] 自动 Layer Plan + Occlusion Graph
[ ] 关键部件可见像素优先提取
[ ] 能补至少脸/头发/手臂三类隐藏区
[ ] 自动生成眼闭/最大张口差分
[ ] 自动输出规范 PSD + Manifest
[ ] PSD round-trip 无结构损失
[ ] 可自动送入至少一个 Rig backend
[ ] 自动生成 neutral + extreme pose QA
[ ] 视觉失败能定位到 layer/problem type
[ ] Agent 能至少执行一轮自动返修
[ ] 所有过程可 rollback / resume
[ ] 有 retry/cost/stop condition
[ ] 最终产物包含来源、版本、报告
```

对于“正式 v1”，再要求：

```text
[ ] AutoLive2d 与 psd2live 双 backend
[ ] psd2live CMO3/MOC3 自动导出
[ ] Eval 数据集和成功率指标
[ ] 单部件失败时可人工替换继续跑
[ ] 重跑结果可复现或至少可追溯
```

---

# 27. 建议的 Codex 主 Agent 指令骨架

下面不是完整 Prompt，而是运行时原则：

```text
You are the project owner of a Live2D asset compilation workspace.

Primary goal:
Produce an editable layered character asset and a downstream rig that passes static and motion validation.

Rules:
1. Preserve master pixels whenever they already exist.
2. Never regenerate an entire layer when only hidden pixels are missing unless the workflow explicitly requires a full-character differential.
3. Never trust image pixel dimensions as canvas placement; use spatial references.
4. Use character-own LEFT/RIGHT.
5. Do not claim completion from a neutral screenshot alone.
6. Validate parameter extremes and occlusion-sensitive poses.
7. Every destructive-looking action must be recoverable through revision history.
8. When repeated image generation does not improve the measured failure, stop and mark the layer for review.
9. PSD and manifest are exchange artifacts; LayerManifest and immutable assets are the internal source of truth.
10. Prefer deterministic tools for masks, transforms, compositing, PSD writing, geometry, and metrics. Use generative image tools only where pixels do not exist or a deliberate differential is required.
```

---

# 28. 推荐立即执行的开发任务

如果现在开始写代码，建议第一批 issue：

1. `LayerManifest v0.1` JSON Schema；
2. `SpatialReference` Schema；
3. content-addressed Asset Store；
4. append-only Revision Store；
5. PNG Layer Composer；
6. PSD writer + read-back test；
7. AutoLive2d input adapter；
8. psd2live CLI/MCP smoke adapter；
9. pose screenshot contract；
10. CV static QA；
11. first Agent workflow: `hair-separation`；
12. A/B benchmark: see-through vs semantic completion。

**其中 1-6 在接任何图像生成 API 前就应该完成。**

原因是如果没有稳定中间表示和 QA，再强的生图模型也只会产生一堆难以追踪的 PNG。

---

# 29. 结论

这个项目最有价值的部分不是“调用 Codex 生成图片”，而是把以下四件事统一成一个可恢复系统：

```text
视觉生成
+ 语义资产编译
+ Rig Backend
+ 验收/返修闭环
```

AutoLive2d 已经证明“生成角色图 -> 自动分层 -> 可动 Runtime”是可以工作的，并积累了非常实用的差分图、附件、预设和回归经验。[A1][A2][A7]

psd2live 则已经搭好了另一半非常关键的基础设施：语义规范、自动 Rig、Cubism 导出、MCP、Spatial Reference、资产回填、历史树和 Agent 领域设计。[P1][P2][P3][P4]

因此新项目没有必要重写一整套 Live2D Runtime 或 Cubism 导出器。

最合理的产品边界是：

> **新 Agent 专注解决“角色从视觉概念变成高质量、可编辑、Rig-ready 的结构化资产”这一最缺失的中间层；AutoLive2d 和 psd2live 作为可插拔下游。**

如果实现顺序遵守本文的 Manifest-first、visible-pixel-first、full-character-differential、pose-QA 和 revision-first 原则，它有机会从“有趣 Demo”发展为真正可无人值守运行、失败可恢复、结果可继续编辑的生产工具。

---

# 附录 A：核心 Schema 最小集合

```text
ProjectSpec
CharacterSpec
SpatialReference
LayerManifest
LayerNode
OcclusionEdge
AssetRevision
GenerationRequest
GenerationResult
PSDImportManifest
DownstreamBuild
ValidationRun
ValidationFinding
TaskCheckpoint
RevisionNode
```

---

# 附录 B：ValidationFinding 示例

```json
{
  "id": "finding_123",
  "severity": "ERROR",
  "type": "HOLE",
  "backend": "psd2live",
  "pose": {
    "ParamAngleX": 30,
    "ParamAngleY": -20
  },
  "region_canvas": [0.41, 0.13, 0.08, 0.12],
  "related_layers": [
    "layer_front_hair_l_01",
    "layer_face"
  ],
  "hypothesis": "front hair moves right and exposes an unpainted forehead region",
  "recommended_action": "expand face hidden completion under front hair by 24 px equivalent",
  "source_screenshot": "sha256:..."
}
```

---

# 附录 C：参考资料

## AutoLive2d

**[A1] AutoLive2d README**  
<https://github.com/Fenglin-Maple/AutoLive2d>

**[A2] PSD Adaptation Guide**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/docs/psd-adaptation-guide.md>

**[A3] Single Screenshot to Adapted Auto Live2D Workflow**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/docs/screenshot-to-live2d-workflow.md>

**[A4] Project Algorithms and Workflow**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/docs/project-algorithms-and-workflow.md>

**[A5] Project Structure**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/docs/project-structure.md>

**[A6] PSD import / mesh implementation descriptions**  
同 [A4]/[A5]，重点参考 `psdImport.ts`, `mesh.ts`, `deform3d.ts` 的职责说明。

**[A7] Rig Validation Checklist**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/docs/rig-validation-checklist.md>

**[A8] AutoLive2d LICENSE (Apache-2.0)**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/LICENSE>

**[A9] AutoLive2d Third Party Notices**  
<https://github.com/Fenglin-Maple/AutoLive2d/blob/main/THIRD_PARTY_NOTICES.md>

## psd2live

**[P1] psd2live README**  
<https://github.com/tsunehimatoi/psd2live>

**[P2] PSD Layer Specification**  
<https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/spec/PSD_LAYER_SPEC.md>

**[P3] Agent Architecture**  
<https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/AGENT_ARCHITECTURE.md>

**[P4] Agent Design**  
<https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/agent/AGENT_DESIGN.md>

**[P5] Project Format**  
<https://github.com/tsunehimatoi/psd2live/blob/master/docs/PROJECT_FORMAT.md>

**[P6] psd2live LICENSE (GPL-3.0)**  
<https://github.com/tsunehimatoi/psd2live/blob/master/LICENSE>

## PSD Libraries

**[T1] ag-psd**  
<https://github.com/skylab-tech/ag-psd>

**[T2] psd-tools**  
<https://github.com/psd-tools/psd-tools>

---

# 附录 D：文档的实施原则

本设计故意将“生成器”放在可替换 Provider 层，而将以下内容做成稳定内核：

- Manifest；
- Spatial Reference；
- Asset Store；
- Revision；
- PSD Compile；
- QC；
- Downstream Adapter。

这样未来即使图像模型、Codex 版本、分割模型、Live2D backend 改变，工程的核心数据和评测方式仍然成立。
