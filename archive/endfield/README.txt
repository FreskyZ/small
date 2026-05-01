Arknights: Endfield related scripts or tools

# Project Status

This project is moved to https://github.com/FreskyZ/akef/tree/161fcbad8d32bc187a29a5cbc7e892fe1b8c791f

The old development history is archived here

Some completed or discontinued subprojects are archived here, include tree drawing algorithms,
in game finance rule investigation, old data source backup, and old workflow for recipe visualization web page

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
