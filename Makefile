.PHONY: help check score room demo
.DEFAULT_GOAL := help

help:
	@echo "make check   - is everything wired"
	@echo "make score   - the scoreboard: maps vs truth"
	@echo "make room    - open the club in a browser"
	@echo "make demo    - the whole chain, one song"

check:
	@python3 -c "import json,sys; m=json.load(open('maps/example.map.json')); \
	  assert m['map']=='0.1'; assert len(m['beats'])==32; assert m['vectors'] is None; \
	  print('map file  OK  ', len(m['beats']),'beats,',len(m['moments']),'moments')"
	@test -f MAP.md && echo "MAP.md    OK"
	@test -f FRAME.md && echo "FRAME.md  OK"
	@test -f RECIPE.md && echo "RECIPE.md OK"
	@echo "--- not built yet (this is expected on day one) ---"
	@test -f score/score.py  || echo "  score/score.py     -> Sebastian"
	@test -f play/play.py    || echo "  play/play.py       -> Dheeraj"
	@test -f room/index.html || echo "  room/index.html    -> Nikhita"
	@test -f listen/listen.py|| echo "  listen/listen.py   -> Amal"

score:
	@test -f score/score.py && python3 score/score.py || \
	  echo "score/score.py does not exist yet. Sebastian owns it. See score/README.md"

room:
	@test -f room/index.html && (xdg-open room/index.html 2>/dev/null || open room/index.html) || \
	  echo "room/index.html does not exist yet. Nikhita owns it. See room/README.md"

demo:
	@echo "the whole chain. target: Friday 4 September."
	@$(MAKE) --no-print-directory check
