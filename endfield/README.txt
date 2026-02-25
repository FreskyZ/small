Arknights: Endfield related scripts or tools

run python script:

```sh
docker run -it -v.:/endfield --name endfield1 mydevc/python:2
cd /endfield
UV_CACHE_DIR=/endfield/.cache uv init
chown 1000:1000 pyproject.toml uv.lock .python-version
uv add numpy pandas matplotlib
uv run finance/trade.py
```

folders:

- backup: raw external data saved here for backup
- finance: arbitrage is a finance topic
- images: images
- sanity: correctly use sanity keeps your sanity
- hechen: this pinyin looks much better than "recipe"

subprojects:
- trade.py: try earn more money
- aesthetic: draw beautiful trees
- essence.py: plan essence
- hechen.html: correctly display recipe
