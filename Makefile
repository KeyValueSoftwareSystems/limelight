.PHONY: help check bench lights chapters demo
.DEFAULT_GOAL := help

help:
	@echo "make check   - is everything wired"
	@echo "make bench   - the scoreboard: maps vs truth"
	@echo "make lights  - open the club in a browser"
	@echo "make chapters- the 20-line second reader. same file"
	@echo "make demo    - the whole chain, one song"

check:
	@python3 -c "import json,sys; m=json.load(open('maps/example.map.json')); \
	  assert m['map']=='0.1'; assert len(m['beats'])==32; assert m['vectors'] is None; \
	  print('map file  OK  ', len(m['beats']),'beats,',len(m['moments']),'moments')"
	@test -f MAP.md && echo "MAP.md    OK"
	@test -f FRAME.md && echo "FRAME.md  OK"
	@test -f RECIPE.md && echo "RECIPE.md OK"
	@echo "--- not built yet (this is expected on day one) ---"
	@test -f bench/bench.py            || echo "  bench/bench.py              -> Sebastian"
	@test -f play/play.py              || echo "  play/play.py                -> Dheeraj"
	@test -f readers/lights/index.html || echo "  readers/lights/index.html   -> Nikhita"
	@test -f listen/listen.py          || echo "  listen/listen.py            -> Amal"
	@echo "--- already works ---"
	@printf "  chapters reader: "; python3 readers/chapters/chapters.py maps/example.map.json | tr "\n" " "; echo

bench:
	@test -f bench/bench.py && python3 bench/bench.py || \
	  echo "bench/bench.py does not exist yet. Sebastian owns it. See bench/README.md"

chapters:
	@python3 readers/chapters/chapters.py maps/example.map.json

lights:
	@test -f readers/lights/index.html && (xdg-open readers/lights/index.html 2>/dev/null || open readers/lights/index.html) || \
	  echo "readers/lights/index.html does not exist yet. Nikhita owns it. See readers/lights/README.md"

demo:
	@echo "the whole chain. target: Friday 4 September."
	@$(MAKE) --no-print-directory check
