import asyncio
import httpx
from main import app

async def test():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        async with app.router.lifespan_context(app):
            r = await client.get("/health")
            print("Health:", r.json())

            r = await client.get("/search", params={"q": "airtel", "limit": 3, "max_scan": 1000})
            d = r.json()
            print(f"Search: {d['scanned_rows']} scanned, {d['total_matches']} matches")
            if d["results"]:
                print("First:", d["results"][0]["name"][:60])

asyncio.run(test())
