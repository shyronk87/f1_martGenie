import asyncio
import json
import random
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse, parse_qs

import aiohttp
from playwright.async_api import async_playwright

# ==============
# 配置区
# ==============
ENTRY_PAGE = "https://www.homary.com/item/3-piece-118-channel-sherpa-linen-sectional-sofa-with-chaise-48742.html"
API_URL = "https://www.homary.com/hm-api/api/yotpo/get-product-reviews"
FIXED_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3ODgwNjY3MDUsInVzZXJfaWQiOiIzNzYzNDQ2MCIsImlzX2xvZ2luIjowfQ.rSgYfUZQsAByIhjXoTLgIZApIhkDkYPxzRlo7z60nNY"

CONCURRENCY = 5
SLEEP_MIN = 0.2
SLEEP_MAX = 1.0

PAGE_SIZE = 50  # 可先用 20；如果接口允许，你也可以尝试 50
MAX_PAGE_GUARD = 300  # 防止极端情况死循环
RETRIES = 4  # 失败重试次数（指数退避）

OUT_PATH = "all_reviews.jsonl"
PRODUCT_ID_FILE = r"E:\nexbuy\result\product_ids.txt"

BASE_PARAMS = {
    "site": "us",
    "language": "en",
    "currency": "usd",
    "pf": "pc",
    "star": "",
    "page_size": str(PAGE_SIZE),
    # "token": 会运行时填充
}

HEADERS = {
    "user-agent": "Mozilla/5.0",
    "accept": "application/json, text/plain, */*",
    "referer": "https://www.homary.com/",
}


# ==============
# 工具函数
# ==============
def jitter_sleep() -> float:
    return random.uniform(SLEEP_MIN, SLEEP_MAX)

def now_ms() -> int:
    return int(time.time() * 1000)

def extract_reviews(payload: Dict[str, Any], fallback_product_id: str) -> List[Dict[str, Any]]:
    data = payload.get("data") or {}
    bottomline = data.get("bottomline") or {}
    reviews = bottomline.get("reviews") or []
    out = []
    for r in reviews:
        prod = r.get("products") or {}
        out.append({
            "review_id": r.get("id"),
            "score": r.get("score"),
            "title": r.get("title"),
            "content": r.get("content"),
            "created_at": r.get("created_at"),
            "verified_buyer": r.get("verified_buyer"),
            "username": r.get("username"),
            "votes_up": r.get("votes_up"),
            "votes_down": r.get("votes_down"),
            "sentiment": r.get("sentiment"),
            "images_data": r.get("images_data") or [],
            "videos_data": r.get("videos_data") or [],
            # 商品维度（以你传入 product_id 为准）
            "product_id": fallback_product_id,
            "sku_id": prod.get("sku_id"),
            "spu_id": prod.get("spu_id"),
            "product_title": prod.get("title"),
            "price": prod.get("price"),
            "status_desc": prod.get("status_desc"),
            "fetched_at_ms": now_ms(),
        })
    return out


# ==============
# Token 管理：Playwright 自动抓 token
# ==============
class TokenManager:
    def __init__(self, entry_page: str, initial_token: Optional[str] = None):
        self.entry_page = entry_page
        self._token: Optional[str] = initial_token
        self._lock = asyncio.Lock()
        self._refreshing: Optional[asyncio.Task] = None

    async def get_token(self) -> str:
        async with self._lock:
            if self._token:
                return self._token
        # 没 token 就刷新
        return await self.refresh_token()

    async def refresh_token(self) -> str:
        async with self._lock:
            # 如果已经有刷新任务在跑，等待它
            if self._refreshing and not self._refreshing.done():
                task = self._refreshing
            else:
                self._refreshing = asyncio.create_task(self._refresh_token_impl())
                task = self._refreshing

        token = await task
        async with self._lock:
            self._token = token
        return token

    async def _refresh_token_impl(self) -> str:
        """
        Capture the review API token from page network traffic.
        """
        from urllib.parse import urlparse, parse_qs

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            )
            page = await context.new_page()

            token_future = asyncio.get_event_loop().create_future()

            async def handle_response(resp):
                try:
                    url = resp.url
                    if "/hm-api/api/yotpo/get-product-reviews" in url and "token=" in url:
                        qs = parse_qs(urlparse(url).query)
                        token = qs.get("token", [None])[0]
                        if token and not token_future.done():
                            token_future.set_result(token)
                except Exception:
                    pass

            page.on("response", handle_response)

            await page.goto(self.entry_page, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(2000)

            for _ in range(3):
                await page.mouse.wheel(0, 6000)
                await page.wait_for_timeout(1200)

            for text in ["Reviews", "Review", "Customer Reviews", "ratings", "Ratings"]:
                try:
                    loc = page.get_by_text(text, exact=False)
                    if await loc.count() > 0:
                        await loc.first.click(timeout=1500)
                        await page.wait_for_timeout(1500)
                except Exception:
                    pass

            await page.mouse.wheel(0, 8000)
            await page.wait_for_timeout(1500)

            try:
                token = await asyncio.wait_for(token_future, timeout=60)
            finally:
                await browser.close()

            if not token:
                raise RuntimeError("Failed to capture token from network response.")
            return token
# ==============
# HTTP 抓取（aiohttp） + 重试退避
# ==============
async def fetch_json(
    session: aiohttp.ClientSession,
    params: Dict[str, str],
    retries: int = RETRIES,
) -> Dict[str, Any]:
    last_err = None
    for attempt in range(retries):
        try:
            await asyncio.sleep(jitter_sleep())  # 每请求随机 sleep
            async with session.get(API_URL, params=params, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=25)) as resp:
                # 这里一般 HTTP 仍是 200，但也可能 403/429
                text = await resp.text()
                if resp.status in (429, 403, 401, 500, 502, 503):
                    raise RuntimeError(f"HTTP {resp.status}: {text[:200]}")
                return json.loads(text)
        except Exception as e:
            last_err = e
            # 指数退避 + jitter
            backoff = (2 ** attempt) * 0.6 + random.uniform(0, 0.3)
            await asyncio.sleep(backoff)
    raise last_err


async def crawl_one_product(
    product_id: str,
    session: aiohttp.ClientSession,
    token_mgr: TokenManager,
    seen_review_ids: Set[str],
    seen_lock: asyncio.Lock,
    out_queue: asyncio.Queue,
) -> int:
    written = 0
    page = 1

    while page <= MAX_PAGE_GUARD:
        token = await token_mgr.get_token()
        params = dict(BASE_PARAMS)
        params["token"] = token
        params["product_id"] = str(product_id)
        params["page"] = str(page)

        payload = await fetch_json(session, params=params)
        code = payload.get("code")

        # code=10001：常见表示没有数据/到头了
        if code == 10001:
            break

        # code != 200：可能 token 过期或风控，刷新 token 再试一次
        if code != 200:
            await token_mgr.refresh_token()
            token = await token_mgr.get_token()
            params["token"] = token
            payload = await fetch_json(session, params=params)
            if payload.get("code") not in (200, 10001):
                raise RuntimeError(f"product_id={product_id} page={page} bad payload: {payload}")

            if payload.get("code") == 10001:
                break

        reviews = extract_reviews(payload, fallback_product_id=product_id)
        if not reviews:
            break

        # 全局去重写出
        new_batch = []
        async with seen_lock:
            for r in reviews:
                rid = r.get("review_id")
                if not rid:
                    continue
                key = f"{product_id}:{rid}"  # 关键修改点
                if key not in seen_review_ids:
                    seen_review_ids.add(key)
                    new_batch.append(r)

        for r in new_batch:
            await out_queue.put(r)
        written += len(new_batch)

        # 如果这页没有新增，往往是重复页/到头了
        if len(new_batch) == 0:
            break

        page += 1

    return written


# ==============
# 输出写入协程：单线程写文件，避免并发写错乱
# ==============
async def writer_task(out_queue: asyncio.Queue, out_path: str):
    with open(out_path, "a", encoding="utf-8") as f:
        while True:
            item = await out_queue.get()
            if item is None:
                out_queue.task_done()
                break
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
            out_queue.task_done()


def load_product_ids(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


# ==============
# 主入口
# ==============
async def main():
    product_ids = load_product_ids(PRODUCT_ID_FILE)
    print(f"Loaded product_ids: {len(product_ids)}")

    token_mgr = TokenManager(ENTRY_PAGE, initial_token=FIXED_TOKEN)
    # 启动前先抓一次 token，避免一开始就并发撞失败
    print("Using fixed token...")
    token = await token_mgr.get_token()
    print("Token ready, prefix:", token[:16], "...")

    connector = aiohttp.TCPConnector(limit=CONCURRENCY * 2, ssl=False)
    out_queue: asyncio.Queue = asyncio.Queue(maxsize=5000)
    seen_review_ids: Set[str] = set()
    seen_lock = asyncio.Lock()

    writer = asyncio.create_task(writer_task(out_queue, OUT_PATH))

    sem = asyncio.Semaphore(CONCURRENCY)

    async with aiohttp.ClientSession(connector=connector) as session:
        results = {"ok": 0, "err": 0, "written": 0}

        async def run_one(pid: str):
            async with sem:
                try:
                    w = await crawl_one_product(
                        product_id=pid,
                        session=session,
                        token_mgr=token_mgr,
                        seen_review_ids=seen_review_ids,
                        seen_lock=seen_lock,
                        out_queue=out_queue,
                    )
                    results["ok"] += 1
                    results["written"] += w
                    if results["ok"] % 50 == 0:
                        print(f"Progress ok={results['ok']} err={results['err']} written={results['written']}")
                except Exception as e:
                    results["err"] += 1
                    print(f"[ERROR] product_id={pid} err={e}")

        tasks = [asyncio.create_task(run_one(pid)) for pid in product_ids]
        await asyncio.gather(*tasks)

        # 等输出队列写完
        await out_queue.join()
        # 关闭 writer
        await out_queue.put(None)
        await writer

    print("DONE. ok:", results["ok"], "err:", results["err"], "total_written_reviews:", results["written"])


if __name__ == "__main__":
    asyncio.run(main())
