0) 这条记录是什么

这是你脚本从 window.__NUXT__ 抽出来的 SPU（款级）记录：

SPU 表示“商品款/主商品”（同款不同配置的集合）

记录里同时附带了 默认 SKU（默认变体） 的价格/库存/活动信息（*_default）

1) 商品身份标识类
spu_id

含义：SPU ID（款 ID），同款商品的唯一标识（不区分具体变体）。

用途：数据库里 SPU 表主键；SKU 表通过 spu_id 外键关联 SPU。

spu_code

含义：SPU 编码（业务系统/ERP 编码）。

用途：对账、内部检索、与外部系统映射；很多时候比 spu_id 更稳定。

url

含义：你抓取的 商品详情页 URL（落地页）。

用途：导购站跳转、去重、调试定位。

canonical

含义：该页面的 规范化 URL（canonical URL）。

用途：SEO 去重（同一个页面可能有多个带参数的 URL），以 canonical 为准做唯一性更稳。

2) 标题与默认 SKU（默认变体）关联
title

含义：商品标题（页面 H1/列表卡片标题）。

用途：展示、搜索、SEO。

sub_title

含义：副标题/补充标题。

这里为 null：说明该商品没有副标题或后端没返回。

用途：有些站会用它展示卖点短句。

sku_id_default

含义：默认 SKU ID（打开详情页时默认选中的那一个 SKU/配置）。

用途：列表页显示默认价格/默认图；与 SKU 表关联；用于“默认落地配置”。

sku_code_default

含义：默认 SKU 的业务编码（ERP/库存编码）。

用途：对账、内部检索、与供应链数据关联。

3) 类目（分类）信息：categories

这是一个对象，分 4 级类目（有些商品只有 3 级，第 4 级为空）。

categories.name1 / name2 / name3 / name4

含义：第 1~4 级类目名称（用于展示/面包屑）。

这里：

name1 = "Home Decoration"

name2 = "Home Sculpture"

name3 = "Animal Sculpture & statue"

name4 = null：没有第 4 级类目（或未配置）

categories.id1 / id2 / id3 / id4

含义：第 1~4 级类目 ID（用于聚合、筛选、建类目树时更稳定）。

这里：

id1 = "7458", id2 = "7483", id3 = "7486"

id4 = "0"：常见表示“无第 4 级”（用 0 占位）

4) 评分/评论/问答
ratingValue

含义：平均评分（通常 1~5）。

这里为 "4.9"（字符串形式）。

reviewCount

含义：评论数量（整数）。

这里为 42。

questions_total

含义：问答（Q&A）总数量。

这里为 null：可能表示该商品无问答/未开启/接口未返回该字段。

5) 主图与图集
product_main_img

含义：主图 URL（列表页封面/详情页第一张图通常用它）。

特点：你这里是 CDN + webp + 750x750 的版本（适合列表展示）。

product_img（数组）

含义：媒体资源列表（包含图片和视频）。

每个元素是一个对象，字段如下（你这条里出现的字段我逐个解释）：

product_img[i].img_url

含义：资源 URL（图片或视频）。

你这里既有 .jpg 也有 .mp4（说明该数组不只是图片）。

product_img[i].img_desc

含义：图片描述（可选）。

你这里多为空字符串。

product_img[i].img_alt

含义：图片 alt 文本（SEO/无障碍）。

视频那条 alt 为空也很常见。

product_img[i].type

含义：资源类型枚举。

常见约定：1 = 图片，2 = 视频

你这条里确实有一条 type: 2 且 img_url 是 .mp4，印证这一点。

product_img[i].imgType

含义：资源用途类型（前端展示用途的枚举/标签）。

你这里是 "product_img_display"：用于产品页展示的媒体。

product_img[i].is_dimension_img（只在部分元素里出现）

含义：是否是“尺寸/重量/维度说明图”。

你这里出现了两张 is_dimension_img: 1，表示它们属于“尺寸图/规格图”。

备注：你这条 product_img 特别多，且含视频（mp4），说明这个字段是“媒体集合”而不是纯图片集合。

6) 商品详情内容
description

含义：商品详情“图文描述/文案”，通常是富文本 HTML。

这里为 null：说明该商品页面没有 description（或被放到别的字段/懒加载/接口没返回）。

这不是错误：有些品类（装饰品）会把详情内容主要放在图集/参数里，description 可能为空。

details（数组）

含义：商品规格参数表（结构化属性列表）。

数组中每一项代表一个属性/参数，你这条里每项对象可能包含以下字段（逐个解释）：

details[j].key

含义：属性名（展示用）。

例如：Style, Material, Warranty, Sku 等。

details[j].value

含义：属性值（当前默认值/展示值）。

例如：Glam, Resin, 3 Year Limited 等。

details[j].sort

含义：排序字段（用于控制参数展示顺序）。

你这里有些是数字（100/200/...），第一条 Sku 的 sort 是空字符串（站内特殊处理常见）。

details[j].pn_id

含义：属性名（Property Name）的内部 ID。

用途：标准化字段、做筛选/映射时比 key 更稳定（key 可能会改名/多语言）。

details[j].pv_id

含义：属性值（Property Value）的内部 ID。

用途：同上，标准化值映射更稳定。

details[j].key_en

含义：属性名英文的标准化版本（通常全小写）。

用途：做程序化映射时更方便（比如统一成 snake_case）。

details[j].is_overview

含义：是否属于“概览区”展示（0/1）。

你这里是 0，表示不是 overview 里的关键属性（或该商品不区分）。

details[j].attr_value_list（数组）

含义：该属性的可选值列表（或者标准化值列表）。

每个元素通常包含：

pn_id / pv_id：同上

value / value_en：值的展示文本

reference_type / reference_id / reference_url / pv_desc：关联信息（比如跳转到说明页、图片说明等；这里大多为空）

特别指出：
details 的第一项是 {key:"Sku", value:"ZS039L1X28"}，它和 sku_code_default 是重复信息（只是另一种位置存了一次）。

7) 概览与规格规则
product_overview

含义：产品概览模块的数据（通常是数组，可能包含卖点短句/图标等）。

这里是 [] 空数组：表示没有概览内容或未返回。

specs_attr_rule

含义：规格/变体规则开关（是否启用规格属性规则）。

这里是 1：表示启用。

注意：启用并不一定代表有多 SKU；有些商品可能仍只有 1 个 SKU，但用同一套规则体系描述。

8) 默认 SKU 的价格信息：price_info_default

这是默认 SKU 的“价格对象”，字段是缩写（为了减少传输体积）。你这条是：

{
  "p": "159.99",
  "ps": "$ 159.99",
  "np": "159.99",
  "nps": "$ 159.99",
  "tp": 0,
  "tps": "",
  "pod": "",
  "po": "",
  "kp": "15999",
  "cp": "140.99",
  "cps": "$140.99",
  "ap": "<span class=\"currency\">$ </span>159<span class=\"point\">.99</span>",
  "fp": "159.99"
}

逐字段解释：

p：当前价（数字字符串）= 159.99

ps：当前价带货币符号的展示字符串 = $ 159.99

np：对比价/原价（通常划线价）= 159.99

nps：原价展示字符串 = $ 159.99

你这里 np == p，说明当前没有折扣（至少在“原价口径”上）。

tp：某种“标签价/参考价/另一口径价”（这里是 0）

tps：tp 的展示字符串（这里为空）

tp=0 且 tps="" 一般代表该口径不适用/未启用。

pod：price off description（折扣描述文案），这里空

po：price off（折扣百分比），这里空（因为没折扣）

kp：以“分”为单位的整数价格（159.99 → 15999），用于计算/排序

cp：另一个价格口径（常见是 coupon price/after coupon price 等）= 140.99

cps：cp 展示字符串 = $140.99

ap：atmosphere price（前端拆分样式的 HTML），用于把货币符号/整数/小数分开显示

fp：final price（最终价，常与 p 相同）= 159.99

实用建议：你如果要“标准字段”，通常只需要：

p（现价）

np（原价）

cp（券后/另一口径价，如果你确认口径）

kp（整数价）
其他多是展示用或营销字段。

9) 默认 SKU 的库存/状态信息：status_info_default
{
  "s": 1,
  "gs": 1,
  "sd": "In stock",
  "eds": 1,
  "pus": 2,
  "wgss": 0,
  "saps": 1,
  "sale_region_status": 1,
  "is_pre": 0,
  "is_pre_subscribe": 0
}

逐字段解释（其中缩写字段是内部状态位，你可以先保留原样）：

s：主状态码（1 通常表示可售/有货）

sd：主状态描述文案（这里是 "In stock"）

sale_region_status：区域可售状态（1 表示当前区域可售）

is_pre：是否预售（0 否）

is_pre_subscribe：预售订阅状态（0 否）

其余内部位（常用于更细业务判断）：

gs：某种全局状态位（常见 global status）

eds：某种配送/预计送达状态位（estimated delivery status 类）

pus：pickup / pickup status（你这里是 2，说明自提/仓配相关可能有不同档位）

wgss：warehouse / group status（0）

saps：sale/after-sale/stock 相关状态位（1）

实用建议：对导购站来说，最常用的是：

s（是否可售）

sd（展示文案）

is_pre（是否预售）
其它字段除非做复杂履约逻辑，否则可不入库或原样存 JSON。

10) 默认 SKU 的活动信息：act_info_default

这里为 null
含义：该默认 SKU 当前没有绑定活动/促销（或接口没返回活动对象）。

当它不为 null 时，通常会包含：

活动价、开始结束时间、活动库存、提示文案等（你之前那条水龙头示例就是非空）。