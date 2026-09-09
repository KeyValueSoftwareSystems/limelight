/* One navbar for the whole portal. Injected by every page with one script tag,
   so adding a door is one line here rather than an edit in eleven files.
   The list is deliberately short: these are the doors that lead somewhere. */
(function(){
  const HERE = location.pathname.replace(/\/$/,"") || "/";
  /* Three doors. There were eleven pages and five links; a navbar that advertises
     a mess is worse than none. studio builds and plays, editor fixes a score,
     score grades one. analyse and dmx are reachable but not advertised until
     they earn a place. */
  const DOORS = [
    ["/studio", "studio"],
    ["/editor", "editor"],
    ["/score",  "score"],
  ];
  const css = document.createElement("style");
  css.textContent = `
    /* Full-bleed no matter what the host page does. score.html has no <body> tag
       and analyse.html is a 100vh flex column, so anything that depends on the
       page's own layout ends up inset or clipped. 100vw with a negative margin
       escapes any centred container; sticky keeps it there while you scroll. */
    #llnav{display:flex;gap:2px;align-items:stretch;background:#0a0d13;
      border-bottom:1px solid #222a3a;font:12px ui-monospace,monospace;
      position:sticky;top:0;z-index:2147483000;
      width:100vw;max-width:100vw;margin-left:calc(50% - 50vw);
      box-sizing:border-box;flex:0 0 auto}
    body{margin-top:0!important}
    #llnav a{padding:7px 13px;color:#7c849a;text-decoration:none;border-right:1px solid #171d28}
    #llnav a:hover{color:#e9ebf3;background:#101620}
    #llnav a.on{color:#e8a33d;background:#12161f;box-shadow:inset 0 -2px 0 #e8a33d}
    #llnav .brand{padding:7px 13px;color:#e8a33d;font-weight:600;letter-spacing:.14em;
      border-right:1px solid #222a3a}
    #llnav .sub{margin-left:auto;padding:7px 13px;color:#59617a}`;
  document.head.appendChild(css);
  const n = document.createElement("div"); n.id = "llnav";
  n.innerHTML = `<span class="brand">LIMELIGHT</span>` +
    DOORS.map(([h,t]) =>
      `<a href="${h}${location.search}" class="${HERE===h?"on":""}">${t}</a>`).join("");
  document.body.insertBefore(n, document.body.firstChild);

  /* A page that already pins its own bar to the top must sit below ours, or the
     two overlap and the page's bar wins because it is painted later. */
  const H = n.offsetHeight || 30;
  document.documentElement.style.scrollPaddingTop = H + "px";
  requestAnimationFrame(() => {
    document.querySelectorAll("body *").forEach(el => {
      if (el === n || n.contains(el)) return;
      const cs = getComputedStyle(el);
      if (cs.position === "sticky" && (cs.top === "0px" || cs.top === "auto"))
        el.style.top = H + "px";
    });
    /* breathing room so a heading does not jam against the bar */
    const first = n.nextElementSibling;
    if (first && !/^(CANVAS|DIV)$/.test(first.tagName)) first.style.marginTop = "14px";
  });
})();
