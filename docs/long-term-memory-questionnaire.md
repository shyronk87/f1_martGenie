# MartGennie Long-Term Memory Questionnaire Design

## Goal

This document proposes a more professional `10-question` long-term memory questionnaire for MartGennie.

The design is based on the current codebase, not on abstract UX theory alone. It answers three questions:

1. Which memory fields are already used by the system today?
2. Which questions are worth asking now, even if some fields are only stored for later use?
3. What tone should the questionnaire use so it feels helpful rather than interrogative?

## What The Current System Actually Uses

Based on the current backend and frontend code:

- Directly used in recommendation, search, or fallback logic today:
  - `style_preferences`
  - `room_priorities`
  - `negative_constraints`
  - `household_members`
  - `price_philosophy`

- Already stored in the memory profile, but not strongly consumed yet:
  - `housing_type`
  - `space_tier`
  - `function_preferences`
  - `notes`

- Available as flexible extension storage:
  - `raw_answers`

## Design Principles For Tone

The questionnaire should sound like a careful design consultant, not like a compliance form.

Recommended tone:

- Warm and practical
  - Ask in a way that sounds like “we want to make better recommendations,” not “we need to collect data.”
- Specific but low-pressure
  - Users should feel they can answer quickly without worrying about the “perfect” answer.
- Everyday language
  - Prefer “Who or what should we keep in mind at home?” over “Please specify household composition.”
- Preference-led, not command-led
  - Avoid hard, absolute wording unless the question is truly about a hard constraint.

## Recommended 10 Questions

| # | Field / Storage | English Question | 中文问题 | 设置这个问题的原因 |
|---|---|---|---|---|
| 1 | `room_priorities` | Which room or area are you most likely to shop for first? | 你最常优先购买的是哪个空间或区域？ | 这是当前最值得收集的输入之一。它可以在用户后续表达比较简短时，帮助系统自动补全房间场景。 |
| 2 | `housing_type` | Are you furnishing an owned home, a rental, or a more temporary space? | 你现在布置的是自有住房、租住房，还是更临时的居住空间？ | 这个问题有助于系统判断推荐应该更偏长期投入、灵活过渡，还是临时可搬移的方案。虽然当前使用还不重，但长期价值很高。 |
| 3 | `space_tier` | For the space you shop for most often, how much room do you usually have to work with? | 对于你最常购买的空间来说，通常可用面积大概属于哪一类？ | 空间大小会直接影响家具尺度、模块化程度和收纳形式。这个字段目前已经存在，后续很适合进一步参与排序和筛选。 |
| 4 | `household_members` | Who or what should we keep in mind at home? You can include pets, children, seniors, or frequent guests. | 家里有哪些人或生活因素需要我们优先考虑？可以包括宠物、小孩、老人，或者经常来访的客人。 | 这个字段今天已经能直接产生价值。当前逻辑会把宠物、儿童、老人等因素转成耐用、安全、易清洁之类的约束条件。 |
| 5 | `style_preferences` | Which interior styles feel most like your home? | 哪些家居风格最符合你的审美和家里的感觉？ | 这是当前推荐、检索和组合中最强的长期偏好信号之一。 |
| 6 | `function_preferences` | What matters most in daily use? For example: storage, easy cleaning, modular layouts, foldable pieces, hidden cables, or kid-safe edges. | 在日常使用上，你最看重哪些功能？例如：收纳、易清洁、模块化、可折叠、隐藏走线、圆角安全等。 | 这是非常高价值的选品语义。字段已经存在，后续应该更明确地影响商品排序和组合解释。 |
| 7 | `price_philosophy` | When buying larger furniture, which approach sounds most like you: value-first, balanced, or premium investment? | 购买大件家具时，你更接近哪种消费取向：性价比优先、均衡型，还是偏长期投入型？ | 这个字段当前已经在使用，会影响推荐倾向更偏预算友好还是更偏品质投入。 |
| 8 | `negative_constraints` | Are there any materials, finishes, colors, or design directions you would like us to avoid? | 有没有哪些材质、工艺、颜色或设计方向是你希望我们尽量避开的？ | 这是当前价值很高的字段，会直接进入分析、检索和过滤逻辑，形成明确的排除条件。 |
| 9 | `notes` | Are there any real-life limitations we should quietly account for? For example: narrow elevators, stairs, frequent moves, difficult assembly, humidity, pet hair, or heavy daily use. | 有没有一些现实条件是我们需要默默替你考虑进去的？例如：电梯狭窄、楼梯搬运、经常搬家、安装麻烦、潮湿环境、宠物毛发、日常高频使用等。 | 这个问题用于收集用户不一定每次都会主动提到、但真实会影响购买决策的细节背景。它很适合未来进入排序和谈判策略。 |
| 10 | `raw_answers["decision_priority"]` | When two options are both good, what usually decides it for you: comfort, durability, easier upkeep, lower total cost, or visual impact? | 当两个方案都不错时，通常最终让你做决定的因素是什么：舒适度、耐用性、好打理、总体花费，还是整体颜值？ | 虽然它目前还不是一级字段，但非常值得先存进 `raw_answers`，后续可以用于优化组合排序、解释方式和谈判重点。 |

## Why These 10 Are Better Than The Current 5

The current 5-question version is useful as a prototype, but it has three weaknesses:

1. It over-focuses on coarse profile data
   - style
   - household
   - price philosophy
   - avoid list

2. It does not capture enough decision context
   - room priority
   - function needs
   - real-life constraints
   - final decision driver

3. It does not sound premium enough
   - Some current questions feel like input collection rather than design guidance.

The new 10-question set improves all three.

## 10 Additional Non-Overlapping Backup Questions

The following `10` are intentionally designed to avoid repeating the first group.

The first 10 already cover:

- room
- housing type
- space
- household composition
- style
- function
- price philosophy
- avoid list
- practical limitations
- decision priority

So this backup set moves to different dimensions:

- trust
- pace
- guidance style
- ownership mindset
- maintenance habits
- emotional confidence
- purchase timing
- comparison fatigue
- negotiation comfort
- post-purchase expectations

| # | Suggested Storage | English Question | 中文问题 | 设置这个问题的原因 |
|---|---|---|---|---|
| 11 | `raw_answers["decision_speed"]` | When shopping for home items, do you usually decide quickly, or do you prefer sitting with options for a while? | 买家居用品时，你通常会很快做决定，还是更喜欢先把几个选项放一放、想一想？ | 这个问题会影响 MartGennie 应该给出多少个备选，以及应该多快帮用户收敛方案。 |
| 12 | `raw_answers["comparison_depth"]` | Do you prefer seeing a short shortlist, or a broader comparison before deciding? | 在做决定前，你更喜欢看到精简的 shortlist，还是更完整的对比范围？ | 它可以帮助系统控制推荐的展开宽度，而不会和风格、预算这类问题重复。 |
| 13 | `raw_answers["guidance_style"]` | When we explain recommendations, what helps you more: a quick answer, a side-by-side comparison, or a deeper explanation of trade-offs? | 当我们解释推荐结果时，哪种方式对你更有帮助：直接给结论、并排对比，还是更详细地讲清取舍？ | 这个问题优化的是解释方式，而不是商品本身。它和前面的功能、风格偏好是不同维度。 |
| 14 | `raw_answers["brand_trust_level"]` | Do you usually feel comfortable with lesser-known brands if the fit looks strong, or do you prefer more familiar names? | 如果产品本身看起来很合适，你能接受相对不那么知名的品牌吗，还是会更偏向熟悉的大品牌？ | 这个问题用于识别用户的信任敏感度，它和价格取向、审美偏好都不是同一件事。 |
| 15 | `raw_answers["negotiation_comfort"]` | If a product is almost right but slightly above budget, would you generally want us to try negotiating, or would you rather skip that step? | 如果某个商品很接近你的理想方案，但价格稍微高一点，你通常更希望我们尝试讲价，还是直接跳过这一步？ | 它可以帮助系统设置更合适的谈判默认策略，这一点并不等同于前面的价格哲学问题。 |
| 16 | `raw_answers["maintenance_attention"]` | In daily life, do you usually enjoy maintaining and caring for your home pieces, or do you prefer things that stay easy with minimal effort? | 在日常生活中，你会比较愿意花心思维护家具，还是更喜欢省心、几乎不用操心的东西？ | 这个问题反映的是“维护态度”，它不同于功能要求，也不同于明确的避雷约束。 |
| 17 | `raw_answers["purchase_timing"]` | Are you usually shopping because you need something soon, or because you are gradually improving the space over time? | 你通常是在“近期就需要买”的情况下购物，还是属于慢慢把空间一点点升级的类型？ | 这个问题有助于系统理解用户的采购节奏，从而影响推荐优先级和组合推进节奏。 |
| 18 | `raw_answers["change_tolerance"]` | Once you choose a direction for a room, do you usually keep it stable, or do you like refreshing the look fairly often? | 当你确定一个空间的大方向后，你通常会保持比较稳定，还是会愿意经常换换感觉？ | 它可以区分“长期稳定型用户”和“喜欢更新变化的用户”，而不会重复询问风格本身。 |
| 19 | `raw_answers["confidence_threshold"]` | Before you purchase, what helps you feel confident enough to move forward: strong value, strong visual fit, strong practical fit, or strong social proof? | 在真正下单前，什么最能让你产生“这次可以放心买”的感觉：价格合适、风格到位、实用性强，还是别人也验证过？ | 这个问题补充的是“建立决策信心的来源”，是前 10 题里没有覆盖的信任维度。 |
| 20 | `raw_answers["post_purchase_priority"]` | After buying, what matters most to you: feeling happy with the look, feeling the purchase was practical, or feeling you made a financially smart choice? | 买完之后，对你来说最重要的是哪种感觉：看着满意、用起来实用，还是觉得这笔钱花得很值？ | 这个问题用于识别用户心中的“购买成功标准”，未来可以帮助系统优化结果表达和后续推荐。 |

## Which Of The Extra 10 Are Most Worth Shipping Soon

If the team wants to expand beyond the first 10, these `5` are the strongest next additions:

1. Decision speed
2. Comparison depth
3. Guidance style
4. Negotiation comfort
5. Confidence threshold

Why these 5 first:

- they create immediate recommendation value
- they are easy for users to answer
- they improve both recommendation quality and downstream agent behavior

## Suggested Rollout Strategy

Instead of shipping all `20` at once, a better rollout is:

### Phase 1: Core 10

Use the first 10 as the required onboarding memory questionnaire.

### Phase 2: Progressive memory enrichment

Ask the extra 10 later in one of these ways:

- inside profile editing
- after 2 or 3 successful sessions
- when the user has enough trust to answer more detailed questions

This avoids making onboarding feel too long while still building a much richer long-term profile.

## Recommended Question Order

The order should move from easy context to deeper preference.

1. Room priority
2. Housing type
3. Space size
4. Household considerations
5. Style preference
6. Function preference
7. Price philosophy
8. Avoid list
9. Real-life limitations
10. Final decision driver

This order works well because:

- the user starts with concrete context
- then moves into taste
- then moves into decision logic

## User-Facing Version In The Requested Order

Below is a user-facing version of the core 10 questions, reordered as:

`2 → 1 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10`

This version is written for real users, not internal product discussion.

- As much as possible, users should choose from options.
- Free input should only be used where structured choices are not enough.
- Each question includes a short explanation telling the user why MartGennie asks for it.

### 1. Housing Type

**English**

What kind of living situation are you furnishing right now?

Options:

- Owned home
- Rental home
- Temporary place
- Shared living arrangement

Why we ask:

This helps us understand whether to prioritize long-term investment, flexibility, or easy-to-move options.

**中文**

你现在主要是在为哪一种居住状态做布置？

可选项：

- 自有住房
- 租住房
- 临时住所
- 合租 / 共享居住

为什么我们会问这个：

这能帮助我们判断，应该更偏向长期投入型推荐，还是更灵活、好搬动、适合过渡阶段的方案。

### 2. Room Priority

**English**

Which space are you most likely to shop for first?

Options:

- Living room
- Bedroom
- Dining room
- Home office
- Entryway
- Outdoor area
- Kids' room
- Other

If `Other`, allow free input.

Why we ask:

This gives us the clearest starting point when you return later with a short or broad request.

**中文**

你接下来最优先想完善的是哪个空间？

可选项：

- 客厅
- 卧室
- 餐厅
- 家庭办公区
- 玄关
- 户外区域
- 儿童房
- 其他

如果选择“其他”，再让用户补充输入。

为什么我们会问这个：

这样当你以后只说一个很简短的需求时，我们也能更快理解你是在为哪个空间找东西。

### 3. Space Tier

**English**

For the space you shop for most often, how would you describe the amount of room you usually have?

Options:

- Compact
- Medium
- Spacious
- Not sure

Why we ask:

This helps us avoid recommending pieces that look good in theory but feel too large or too small in real life.

**中文**

对于你最常购买的那个空间，你觉得可用面积更接近哪一种？

可选项：

- 紧凑型
- 中等大小
- 比较宽敞
- 还不确定

为什么我们会问这个：

这样可以帮助我们避免推荐“看起来不错，但真实放进去尺度不合适”的商品。

### 4. Household Members

**English**

Who or what should we keep in mind in your home?

Options:

- Just me
- Partner / family
- Children
- Cat
- Dog
- Senior family member
- Frequent guests

Multi-select allowed.

Why we ask:

This helps us pay attention to durability, safety, comfort, and ease of cleaning in a more practical way.

**中文**

在家里生活这件事上，有哪些人或因素是我们需要优先考虑的？

可选项：

- 我自己一个人
- 伴侣 / 家人
- 小孩
- 猫
- 狗
- 老人
- 经常有客人来

支持多选。

为什么我们会问这个：

这能帮助我们更实际地考虑耐用性、安全性、舒适度和清洁维护这些问题。

### 5. Style Preferences

**English**

Which styles feel most like your taste?

Options:

- Japandi
- Modern Minimalist
- Industrial
- Creamy / Soft
- Scandinavian
- Mid-Century
- Contemporary
- Not sure yet

Multi-select allowed, recommend up to 3.

Why we ask:

This helps us keep recommendations visually consistent, especially when we build full sets instead of single items.

**中文**

哪些风格最接近你的审美？

可选项：

- Japandi
- 现代极简
- 工业风
- 奶油 / 柔和风
- 北欧风
- 中古 / Mid-Century
- 当代风
- 还不确定

支持多选，建议最多选 3 个。

为什么我们会问这个：

这样我们在推荐整套组合时，能更好地保持整体视觉风格的一致性。

### 6. Function Preferences

**English**

What matters most to you in daily use?

Options:

- More storage
- Easy to clean
- Modular / flexible layout
- Foldable / space-saving
- Hidden cable management
- Kid-safe / rounded edges
- Pet-friendly surfaces
- Low maintenance

Multi-select allowed.

Why we ask:

This helps us recommend items that fit your real daily life, not just your aesthetic preferences.

**中文**

在日常使用里，你最看重哪些实际功能？

可选项：

- 更强的收纳能力
- 容易清洁
- 模块化 / 可灵活组合
- 节省空间 / 可折叠
- 隐藏走线更整洁
- 更安全的圆角设计
- 对宠物更友好
- 更省心、好维护

支持多选。

为什么我们会问这个：

这样我们推荐出来的，不只是“看起来适合”，而是真正更贴近日常使用习惯。

### 7. Price Philosophy

**English**

When shopping for larger home pieces, which approach sounds most like you?

Options:

- Value-first
- Balanced
- Premium investment

Why we ask:

This helps us understand whether we should lean toward budget efficiency, a balanced mix, or stronger long-term quality.

**中文**

在购买大件家居时，你更接近哪一种消费取向？

可选项：

- 性价比优先
- 均衡型
- 偏长期投入 / 品质优先

为什么我们会问这个：

这能帮助我们判断，推荐时应该更偏向预算效率、均衡搭配，还是更看重长期品质。

### 8. Things To Avoid

**English**

Is there anything you already know you want to avoid?

Suggested options:

- Hard-to-clean fabrics
- Sharp edges
- Glass-heavy pieces
- Bulky silhouettes
- Delicate finishes
- Very bright colors
- No strong preference

Also allow free input:

- Other things to avoid

Why we ask:

This helps us reduce bad matches earlier, so you spend less time filtering out options you already know will not work.

**中文**

有没有一些你已经知道自己想尽量避开的东西？

建议可选项：

- 难清洁的面料
- 尖角设计
- 玻璃感太重的家具
- 体量太笨重的款式
- 太娇贵的表面处理
- 颜色过于跳脱
- 暂时没有特别要避开的

同时开放一个自由输入项：

- 其他想避开的点

为什么我们会问这个：

这样我们能更早排除不合适的选项，减少你后面反复筛掉不想要商品的时间。

### 9. Real-Life Notes

**English**

Are there any real-life details we should keep in mind?

Suggested options:

- Narrow elevator
- Stairs only
- Frequent moving
- Humid environment
- Heavy daily use
- Limited assembly time
- Not applicable

Also allow free input:

- Anything else we should quietly keep in mind

Why we ask:

These details often affect whether a product works in real life, even if the style and price look right.

**中文**

有没有一些现实条件，是你希望我们默默帮你考虑进去的？

建议可选项：

- 电梯比较窄
- 只有楼梯搬运
- 可能经常搬家
- 居住环境偏潮湿
- 日常使用频率很高
- 没太多时间自己安装
- 暂时没有

同时开放一个自由输入项：

- 其他希望我们一起考虑的现实情况

为什么我们会问这个：

这些细节往往会直接影响“东西到底适不适合真实生活”，哪怕它在风格和价格上看起来都没问题。

### 10. Final Decision Driver

**English**

When two options both look good, what usually helps you make the final call?

Options:

- Comfort
- Durability
- Easier upkeep
- Lower total cost
- Better overall look
- Best overall value

Why we ask:

This helps us understand what should matter most when we rank similar options for you.

**中文**

当两个方案都不错时，通常什么最能帮助你做最后决定？

可选项：

- 更舒服
- 更耐用
- 更好打理
- 总花费更低
- 整体更好看
- 综合下来更值

为什么我们会问这个：

这能帮助我们在几个都不错的方案之间，知道应该优先把哪一种排在前面。

## Implementation Notes Against Current Code

### Fields already supported by the current payload

These can be saved immediately without schema change:

- `housing_type`
- `space_tier`
- `household_members`
- `style_preferences`
- `price_philosophy`
- `negative_constraints`
- `room_priorities`
- `function_preferences`
- `notes`
- `raw_answers`

### No backend schema change is strictly required for the questionnaire itself

Because the current memory payload already supports all of the following:

- `space_tier`
- `room_priorities`
- `function_preferences`
- `notes`
- `raw_answers`

That means the product can move from `5` questions to `10` questions without first changing the profile table shape.

### What the system will benefit from immediately

Immediate benefit today:

- better room fallback
- better style fallback
- better household-aware constraints
- better budget/ranking behavior

Medium-term benefit after follow-up implementation:

- space-aware ranking
- function-aware bundle reasoning
- better justification text
- more context-aware negotiation strategy
- negotiation-default personalization
- explanation-format personalization
- shortlist-width personalization
- trust-aware recommendation framing

## Recommended UX Wording Style

The following style should be preserved in both Chinese and English:

- Ask gently
  - “Which room are you most likely to shop for first?”
  - not “Select your primary room type.”

- Invite practical thinking
  - “What matters most in daily use?”
  - not “Choose functional attributes.”

- Avoid sounding legalistic
  - “Are there any materials or designs you want us to avoid?”
  - not “Specify prohibited materials.”

## Summary

The best next version of MartGennie long-term memory is not just “more questions.”

It should be:

- more specific
- more useful to the current recommendation pipeline
- more future-proof for ranking and negotiation
- more natural in tone

The 10-question set above is the right next step because it fits the current code structure while materially improving the quality of memory collected.
