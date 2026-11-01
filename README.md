# Lanternfall

An original fantasy grand-strategy game for the browser: six houses fight over the 24 provinces of
Varenhold and the five Lantern Shards that bind its spirits. Develop farms and markets, muster and
train troops, hire companies, make pacts and fight tactical battles with spirit magic.

* Play: open `index.html` through a web server (`python3 serve.py`, then http://127.0.0.1:8770/).
* Wiki: `wiki.html`, generated from the game data.
* Design and module contracts: `docs/DESIGN.md`. Art shot list: `docs/SHOTLIST.md`.
* Tests: `node tests/run-all.mjs`.

The game is playable with placeholder art; drop the 100 generated images into `uploads/` and run
`python3 tools/process_art.py uploads` to install them.
