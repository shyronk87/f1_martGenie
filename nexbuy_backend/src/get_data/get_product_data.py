import asyncio
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, Any, List, Optional

from playwright.async_api import async_playwright

# ====== 你的路径配置（按你给的固定）======
SITEMAP_XML = Path(r"E:\nexbuy\data\google_sitemap_item_us.xml")
OUT_DIR = Path(r"E:\nexbuy\result")
SPU_OUT = OUT_DIR / "homary_spu.jsonl"
SKU_OUT = OUT_DIR / "homary_sku.jsonl"

# ====== Nuxt 抽取脚本（保持不变）======
EXTRACT_JS = """
() => {
  const nuxt = window.__NUXT__ || {};
  const page0 = (Array.isArray(nuxt.data) && nuxt.data.length) ? nuxt.data[0] : {};
  const ps_page = page0.productStaticInfo || {};
  const pi_page = page0.productInfo || {};

  // 优先用 Vuex 里的 productStaticInfo（含 sku_list）
  const ps = (nuxt.state && nuxt.state.product && nuxt.state.product.productStaticInfo)
    ? nuxt.state.product.productStaticInfo
    : ps_page;

  // 找出包含 sku_list 的 block（一般唯一；若多个取 len 最大）
  const blocks = ps.product_img || [];
  let best = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && Array.isArray(b.sku_list) && b.sku_list.length) {
      if (!best || b.sku_list.length > best.sku_list.length) best = b;
    }
  }
  const sku_list = best && Array.isArray(best.sku_list) ? best.sku_list : [];

  return {
    routePath: nuxt.routePath || null,
    canonical: page0.linkCanonicalUrl || null,

    spu: {
      spu_id: ps.spu_id || null,
      spu_code: ps.spu_code || null,
      title: ps.title || null,
      sub_title: ps.sub_title || null,

      sku_id_default: ps.sku_id || null,
      sku_code_default: ps.sku_code || null,

      categories: {
        name1: ps.spu_category_name_first || null,
        name2: ps.spu_category_name_second || null,
        name3: ps.spu_category_name_third || null,
        name4: ps.spu_category_name_fourth || null,
        id1: ps.spu_category_id_first || null,
        id2: ps.spu_category_id_second || null,
        id3: ps.spu_category_id_third || null,
        id4: ps.spu_category_id_fourth || null,
      },

      ratingValue: ps.ratingValue || null,
      reviewCount: ps.reviewCount || null,
      questions_total: ps.questions_total || null,

      product_main_img: ps.product_main_img || null,
      // product_img 很大，先保留原样（可后续精简）
      product_img: ps.product_img || null,

      description: ps.description || null,
      details: ps.details || null,
      product_overview: ps.product_overview || null,

      specs_attr_rule: ps.specs_attr_rule || null,

      // 默认 SKU 的动态信息（不一定覆盖所有变体，但可以留作参考）
      price_info_default: pi_page.price_info || pi_page.priceInfo || null,
      status_info_default: pi_page.status_info || pi_page.statusInfo || null,
      act_info_default: pi_page.act_info || pi_page.actInfo || null,
    },

    sku_block: best ? { len: sku_list.length } : null,
    sku_list: sku_list
  };
}
"""

def parse_attr_group_str(s: Optional[str]) -> Dict[str, str]:
    if not s:
        return {}
    parts = [p.strip() for p in s.split("|") if p.strip()]
    out: Dict[str, str] = {}
    for p in parts:
        if ":" in p:
            k, v = p.split(":", 1)
            out[k.strip()] = v.strip()
        else:
            out[p] = ""
    return out


def load_urls_from_sitemap_xml(xml_path: Path) -> List[str]:
    """
    解析解压后的 sitemap xml（urlset），提取全部 <loc> URL
    """
    if not xml_path.exists():
        raise FileNotFoundError(f"找不到 sitemap 文件: {xml_path}")

    tree = ET.parse(xml_path)
    root = tree.getroot()

    # sitemap 命名空间
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls: List[str] = []
    for url_node in root.findall("sm:url", ns):
        loc = url_node.findtext("sm:loc", default="", namespaces=ns).strip()
        if loc:
            urls.append(loc)

    # 去重（保持相对稳定顺序）
    seen = set()
    out = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


async def main():
    # 1) 从 sitemap 读取全站产品 URL
    urls = load_urls_from_sitemap_xml(SITEMAP_XML)
    print(f"Loaded {len(urls)} product URLs from sitemap: {SITEMAP_XML}")

    # 2) 输出目录
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 3) Playwright 批量抓取
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_extra_http_headers({"Accept-Language": "en-US,en;q=0.9"})

        with SPU_OUT.open("w", encoding="utf-8") as spu_f, SKU_OUT.open("w", encoding="utf-8") as sku_f:
            for i, url in enumerate(urls):
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    await page.wait_for_function(
                        "() => !!window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state.product",
                        timeout=20000,
                    )

                    rec = await page.evaluate(EXTRACT_JS)

                    # SPU
                    spu = rec["spu"]
                    spu["url"] = url
                    spu["canonical"] = rec.get("canonical")
                    spu_f.write(json.dumps(spu, ensure_ascii=False) + "\n")

                    # SKU
                    sku_list: List[Dict[str, Any]] = rec.get("sku_list") or []
                    if sku_list:
                        for s in sku_list:
                            sku_id = s.get("sku_id") or s.get("skuId") or s.get("id")
                            attr_str = s.get("attr_group_str") or s.get("attrGroupStr")
                            sku_rec = {
                                "url": url,
                                "spu_id": spu.get("spu_id"),
                                "sku_id": sku_id,
                                "sku_code": s.get("sku_code") or s.get("skuCode"),
                                "title": s.get("title"),
                                "price": s.get("price") or s.get("activity_price"),
                                "tag_price": s.get("tag_price"),
                                "price_symbol": s.get("price_symbol") or s.get("activity_price_symbol"),
                                "tag_price_symbol": s.get("tag_price_symbol"),
                                "img_url": s.get("img_url") or s.get("attr_img_url"),
                                "status": s.get("status"),
                                "status_desc": s.get("status_desc"),
                                "review_score": s.get("review_score"),
                                "review_num": s.get("review_num"),
                                "activity_id": s.get("activity_id"),
                                "activity_type": s.get("activity_type"),
                                "activity_status": s.get("activity_status"),
                                "activity_price": s.get("activity_price"),
                                "attr_group_str": attr_str,
                                "attributes": parse_attr_group_str(attr_str),
                                "raw": s,
                            }
                            sku_f.write(json.dumps(sku_rec, ensure_ascii=False) + "\n")
                    else:
                        # 单 SKU 商品
                        sku_rec = {
                            "url": url,
                            "spu_id": spu.get("spu_id"),
                            "sku_id": spu.get("sku_id_default"),
                            "sku_code": spu.get("sku_code_default"),
                            "attr_group_str": None,
                            "attributes": {},
                            "raw": None,
                        }
                        sku_f.write(json.dumps(sku_rec, ensure_ascii=False) + "\n")

                    print(i, "OK", spu.get("spu_id"), url)

                except Exception as e:
                    print(i, "ERR", url, e)

                # 温和限速
                await page.wait_for_timeout(250)

        await browser.close()

    print(f"Done. Outputs:\n  {SPU_OUT}\n  {SKU_OUT}")


if __name__ == "__main__":
    asyncio.run(main())