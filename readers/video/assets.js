// Shots, and how well each one suits a brief. One writer for both policies.
//
// policy_naive, policy_rules and policy_llm all have to pick clips. If each
// carried its own idea of "suits the brief", a difference between two edits
// could be a difference in taste or a difference in bookkeeping, and nobody
// could tell which -- which would make the whole A/B worthless. So the scoring
// lives here once, and the policies differ only in WHEN they cut and WHICH
// shot they ask for.
//
// Purity: fit(shot, brief) is a function of its two arguments. No clock, no
// randomness, no memory. Reuse and continuity are the caller's business,
// because they depend on what the caller has already placed.
"use strict";

const ASSETS = (function () {

  // How far outside a preferred range a value sits, as a fraction of the range.
  // Inside costs nothing. Outside costs proportionally, so a brief that wants
  // [0,70] px/s is unbothered by 40 and mildly bothered by 90.
  function outside(v, range) {
    if (v === null || v === undefined || !range) return 0;
    const [lo, hi] = range;
    const span = Math.max(1e-6, hi - lo);
    if (v < lo) return (lo - v) / span;
    if (v > hi) return (v - hi) / span;
    return 0;
  }

  // The measured fields a brief is allowed to express a preference about.
  // A brief naming anything else is asking for a guess; briefs/check.py
  // refuses it rather than silently ignoring it.
  const PREFERABLE = ["camera_motion_px_s", "subject_motion_px_s",
                      "brightness", "contrast", "saturation", "faces"];

  // 1.0 is a shot squarely inside every preference; 0.0 is hopeless.
  // How much this shot is DOING, on the same 0..1 scale the story curve uses.
  // Motion is the bulk of it because that is what reads as a busy picture; the
  // shot's own length matters too, because a long take is a calm one whatever
  // is moving inside it. Both are measurements already in the index, so no new
  // pass over the video and nothing invented.
  //
  // The scale is set by the pool, not by a constant: 600 px/s is frantic in a
  // product film and ordinary in a chase, and a fixed number would silently
  // mean different things to different sets.
  function pictureEnergy(shot, scale) {
    const m = shot.subject_motion_px_s;
    const c = shot.camera_motion_px_s;
    const mv = (m === null || m === undefined) ? (c || 0) : m;
    const e = Math.min(1, mv / Math.max(1, scale || 400));
    const long = Math.min(1, (shot.duration || 1) / 4.0);
    return Math.max(0, Math.min(1, 0.75 * e + 0.25 * (1 - long)));
  }

  // Every shot's standing in the pool on "how much of the subject is in it",
  // as a 0..1 rank. Ranked, not thresholded: CLIP's absolute cosines all sit
  // near 0.25 and a threshold on them selected 320 shots out of 320 once.
  function subjectRanking(pool, semIdx, word) {
    const out = new Map();
    if (!semIdx || !word) return out;
    const rows = [];
    for (const s of pool) {
      const k = s.clip_id + "#" + s.shot;
      const r = semIdx.get(k);
      const c = r && r.content ? r.content[word] : undefined;
      if (c !== undefined) rows.push([c, k]);
    }
    rows.sort(function (a, b) { return a[0] - b[0]; });
    rows.forEach(function (r, i) {
      out.set(r[1], rows.length < 2 ? 0.5 : i / (rows.length - 1)); });
    return out;
  }

  function energyScale(pool) {
    const v = pool.map(function (x) {
      const m = x.subject_motion_px_s;
      return (m === null || m === undefined) ? (x.camera_motion_px_s || 0) : m;
    }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    if (!v.length) return 400;
    return Math.max(60, v[Math.floor(v.length * 0.9)]);
  }

  function fit(shot, brief) {
    const prefs = (brief && brief.prefers) || {};
    let penalty = 0, n = 0;
    for (const k of PREFERABLE) {
      if (!(k in prefs)) continue;
      const v = shot[k];
      // A field the index could not measure is not a field the shot fails.
      // faces === null means nothing looked; scoring it as 0 faces would
      // invent a measurement.
      if (v === null || v === undefined) continue;
      penalty += Math.min(2, outside(v, prefs[k]));
      n += 1;
    }
    if (!n) return 0.5;   // nothing comparable: neutral, not good, not bad
    return 1 / (1 + penalty / n);
  }

  // How well a shot matches the subject the BRIEF asked for, in words.
  //
  // This is what replaces a person choosing clips off a contact sheet. Three
  // sets in this repo say `how: curated` because no measurement here could tell
  // a coastline from a car park -- brightness, motion and a look vector
  // separate bright from dark and still from moving and nothing else. CLIP can
  // name the footage, and a brief can name what it wants, so the choice becomes
  // a comparison between two lists of words.
  //
  // Returns null when there is no semantic data or the brief names no subject,
  // and callers treat null as "no opinion" rather than as zero.
  function subjectFit(shot, brief, sem) {
    const want = brief && brief.subject;
    if (!want || !want.length || !sem) return null;
    const row = sem.get(shot.clip_id + "#" + shot.shot);
    if (!row || !row.content) return null;
    let best = -1;
    for (const w of want) {
      const v = row.content[w];
      if (v !== undefined && v > best) best = v;
    }
    return best < 0 ? null : best;
  }

  // Semantic rows keyed for lookup, or null if the set has none.
  function semanticIndex(sem) {
    if (!sem || !sem.shots) return null;
    const m = new Map();
    for (const r of sem.shots) m.set(r.clip_id + "#" + r.shot, r);
    return m;
  }

  // Keep the shots that are OF what the brief asked for.
  //
  // The criterion is ARGMAX, not a threshold. CLIP's absolute cosines all sit
  // around 0.25 and carry no meaning on their own -- a first version kept
  // everything within 0.055 of the best score and selected 320 shots out of
  // 320, which is the mistake its own comment warned about. What does carry
  // meaning is which word wins: a shot whose best match across the whole
  // vocabulary is "a waterfall" is a shot of a waterfall, and one whose best
  // match is "a server rack" is not, whatever the numbers are.
  //
  // `subject_also_ranked` widens it by rank rather than by score when argmax
  // alone leaves too few: the best N by affinity, which is still a comparison
  // between shots rather than against a constant.
  function selectBySubject(pool, brief, sem, _tol, minKeep) {
    const idx = semanticIndex(sem);
    const want = brief && brief.subject;
    if (!idx || !want || !want.length) return pool;
    const need = minKeep || 8;
    const wanted = new Set(want);

    const primary = [], ranked = [];
    for (const s of pool) {
      const row = idx.get(s.clip_id + "#" + s.shot);
      if (!row || !row.content) continue;
      const top = (row.content_top && row.content_top[0]) ||
        Object.keys(row.content).reduce(function (a, b) {
          return row.content[b] > row.content[a] ? b : a;
        });
      const f = subjectFit(s, brief, idx);
      if (f !== null) ranked.push([f, s]);
      if (wanted.has(top)) primary.push(s);
    }
    if (primary.length >= need) return primary;
    if (ranked.length < need) return pool;
    ranked.sort(function (a, b) { return b[0] - a[0]; });
    return ranked.slice(0, need).map(function (x) { return x[1]; });
  }

  // How much a shot FEELS like the music does at this moment.
  //
  // The map's observations.mood gives a value per term per section, from
  // MuQ-MuLan. assets/semantic.py gives a distribution over the SAME terms per
  // shot, from CLIP. Neither model has seen the other and they do not share a
  // space; what they share is the ten words. So a match here means MuLan calls
  // this passage cold and CLIP calls this picture cold -- an agreement between
  // two strangers about a word, which is a real signal and a weak one, and is
  // weighted accordingly by the brief.
  //
  // Cosine, after centring both vectors. Without centring every shot scores
  // high against every section, because both distributions are dominated by
  // whichever terms are generally large.
  function moodFit(shot, sectionMood, semIdx) {
    if (!sectionMood || !semIdx) return null;
    const row = semIdx.get(shot.clip_id + "#" + shot.shot);
    if (!row || !row.mood) return null;
    const terms = Object.keys(sectionMood);
    if (terms.length < 3) return null;
    const a = [], b = [];
    for (const t of terms) {
      if (row.mood[t] === undefined) continue;
      a.push(sectionMood[t]); b.push(row.mood[t]);
    }
    if (a.length < 3) return null;
    const ma = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
    const mb = b.reduce(function (x, y) { return x + y; }, 0) / b.length;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      dot += x * y; na += x * x; nb += y * y;
    }
    if (na < 1e-9 || nb < 1e-9) return null;
    return dot / Math.sqrt(na * nb);              // -1 to 1
  }

  // The map's mood at an instant: the section it falls in.
  function moodAt(map, t) {
    const mo = (map.observations || {}).mood;
    if (!mo || !Array.isArray(mo.at) || !Array.isArray(mo.value) || !mo.terms) return null;
    let i = -1;
    for (let k = 0; k < mo.at.length; k++) if (mo.at[k] <= t + 1e-9) i = k;
    if (i < 0 || !mo.value[i]) return null;
    const out = {};
    mo.terms.forEach(function (w, k) { out[w] = mo.value[i][k]; });
    return out;
  }

  // Every shot of every clip, flattened, with its fit already computed.
  //
  // A long shot is cut into several MOMENTS. A 20-second take holds five
  // different four-second pictures, and treating it as one choice is why an
  // edit built from 13 clips kept returning to the same few images -- "the same
  // clips again and again". The measurements are the shot's; what differs is
  // where in it we enter, which is exactly what an editor is choosing when they
  // pick a moment out of a take.
  function shots(index, brief, sliceLen) {
    const out = [];
    const SL = sliceLen || 4.5;
    for (const c of index.clips || []) {
      (c.shots || []).forEach(function (s, i) {
        if (s.duration < 0.35) return;
        const n = Math.max(1, Math.floor(s.duration / SL));
        if (n > 1) {
          const w = s.duration / n;
          for (let k = 0; k < n; k++) {
            out.push(Object.assign({}, s, {
              clip_id: c.clip_id, shot: i,
              moment: k, moments_in_shot: n,
              start: +(s.start + k * w).toFixed(3),
              end: +(s.start + (k + 1) * w).toFixed(3),
              duration: +w.toFixed(3),
              clip_duration: c.duration_s,
              source_category: c.source_category || null,
              look: s.look || null,
              fit: fit(s, brief)
            }));
          }
          return;
        }
        out.push(Object.assign({}, s, {
          clip_id: c.clip_id, shot: i,
          clip_duration: c.duration_s,
          // The source's category. Not a measurement and not trusted as one --
          // it is the only signal available about whether two shots belong to
          // the same world, and it is the source's opinion. A real subject
          // model would replace it.
          source_category: c.source_category || null,
          look: s.look || null,
          fit: fit(s, brief)
        }));
      });
    }
    return out;
  }

  // Pick the NEXT shot in the source's own order.
  //
  // A finished film is not inventory. The 5C spot walks liquid plastic into a
  // shell into the phone, and red into green into yellow into blue; re-cutting
  // it by fit and continuity reordered those shots 9, 3, 12, 13, 8, 1, ... and
  // threw the whole argument away. Against the original the result was not
  // close, and the reason was never the timing.
  //
  // So when a brief says `preserve_order`, the job stops being "choose a shot"
  // and becomes "advance through the film". The music still decides WHEN to
  // cut and for how long -- which is the part worth automating -- and the order
  // the editor chose is left alone.
  // The order nextInOrder walks, as a list, so a caller can ask WHERE in it a
  // given moment of the source film sits.
  function orderedPool(pool, brief) {
    const ordered = pool.slice().sort(function (a, b) {
      if (a.clip_id !== b.clip_id) return a.clip_id < b.clip_id ? -1 : 1;
      if (a.shot !== b.shot) return a.shot - b.shot;
      return (a.moment || 0) - (b.moment || 0);
    });
    // Order is preserved, but a shot the brief plainly does not want is still
    // skipped. The 5C source begins and ends on black -- the detector finds
    // those as shots 0 and 14 at brightness 0.00 -- and marching through them in
    // order opens the film on a black frame.
    //
    // `fit` is the wrong test for this: a black shot violates one preference out
    // of five, so its fit is still 0.85. Brightness is checked directly, because
    // "outside the range the brief asked for" is the actual complaint.
    const br = ((brief || {}).prefers || {}).brightness;
    const keep = ordered.filter(function (x) {
      if (x.brightness === null || x.brightness === undefined) return true;
      if (br && (x.brightness < br[0] - 0.02 || x.brightness > br[1] + 0.02)) return false;
      return x.fit >= 0.30;
    });
    return keep.length >= 3 ? keep : ordered;
  }

  // Where in that order the film is at source time `t`. A music video and its
  // song are the same piece of time: shot 57 belongs at 2:03 because that is
  // when it was cut to. Starting the cursor at zero while the music is at 2:03
  // plays the opening of the film underneath the climax of the song, which is
  // exactly what it sounds like -- no build, no arrival, nothing landing.
  function orderIndexAt(pool, brief, t) {
    const list = orderedPool(pool, brief);
    for (let i = 0; i < list.length; i++) {
      if (list[i].end > t) return i;
    }
    return 0;
  }

  function nextInOrder(pool, used, want, brief) {
    const list = orderedPool(pool, brief);
    if (!list.length) return null;
    const n = used.get("__cursor__") || 0;
    // Strictly the next shot. `want` is read by the caller, not here: a slot
    // the next shot cannot fill is a cut that has to come earlier, and only the
    // policy may decide when a cut happens. An earlier version scanned forward for one long
    // enough to fill the slot, which stopped the compiler running past a shot
    // end but produced the order 1, 12, 12, 13, 1, 2 -- it jumped to the only
    // two long shots in the film and back, which is precisely the re-ordering
    // preserve_order exists to forbid. A slot the next shot cannot fill is the
    // POLICY's problem to solve, by cutting earlier, and it solves it there.
    const s = list[n % list.length];
    used.set("__cursor__", n + 1);
    return s;
  }

  // Pick a shot for a slot of `want` seconds.
  //
  // `avoid` is the clip most recently on screen and `kin` is the world it came
  // from -- the source's own category, which is the only thing here that knows
  // two shots belong together.
  //
  // THIS FUNCTION USED TO OPTIMISE FOR INCOHERENCE, and it is worth stating
  // plainly because the effect was severe and invisible in every number the
  // scorer produced. It refused to reuse the previous clip and it scored unused
  // clips higher, so across a 38-shot edit it selected 38 different clips and
  // changed subject on 92% of cuts: snow, then a flower, then a server room.
  // Timing was fine. A person watched three edits built this way and rejected
  // all three -- "random clips pieced together without any emotion" -- and was
  // right. Optimising for variety IS optimising for incoherence.
  //
  // Now the default pull is the other way: staying in the same world is
  // rewarded, and `allowKin` lets the caller relax that at a structural
  // boundary, where a change of subject is the point rather than an accident.
  // `impact` is how big the moment being cut TO is, 0 to 1.
  //
  // Without it every cut is chosen the same way, and the climax gets whatever
  // happened to fit -- on one render the two tightest shots in the piece, the
  // 0.94 s pair landing exactly on the drop, were a static drum cymbal. A
  // drop deserves the most alive picture available, not a picture that merely
  // suits the brief's ranges. At impact 1 the choice leans hard on movement and
  // on faces; at impact 0 it does not lean at all, so ordinary bars still get
  // continuity rather than spectacle.
  function choose(pool, want, used, avoid, brief, seed, kin, allowKin, impact,
                  sectionMood, semIdx, prevWord, storyWant, escale,
                  subjectWant, subjWord, subjRank) {
    const imp = Math.max(0, Math.min(1, impact || 0));
    // Normalised against the pool, so "a lot of movement" means a lot for this
    // footage rather than a number carried over from other footage.
    let maxSub = 0;
    for (const s of pool) if ((s.subject_motion_px_s || 0) > maxSub) maxSub = s.subject_motion_px_s || 0;
    const maxReuse = (brief.callbacks && brief.callbacks.max_reuses_per_clip) || 2;
    const distinctClips = (function () {
      const c = new Set();
      for (const x of pool) c.add(x.clip_id);
      return c.size;
    })();
    // -Infinity, not -1. Every term added here since has been a PENALTY, and
    // two of them together (story -0.55, arrival -0.65) can put every candidate
    // in the pool below a floor of -1. `choose` then returns null, the policy
    // does `if (!s) continue`, and the slot is silently dropped -- which is how
    // adding a story curve turned a 14-shot held-out edit into a 13-shot one
    // with different cut times and no error anywhere.
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      // Cutting from a TAKE straight back to itself reads as a jump cut. Two
      // different shots of the same source file are not that -- they are what
      // every edit is made of.
      //
      // This compared clip_id, which is the source FILE. Handed a pool that is
      // one file containing fifteen shots -- an existing advertisement, to be
      // re-cut -- every candidate after the first looked like "the clip already
      // on screen" and the policy could place exactly one shot.
      if (avoid && (s.clip_id + "#" + s.shot) === avoid) continue;
      // TWO counters, because one was not enough.
      //
      // Reuse was counted per MOMENT, so a clip cut into six moments could
      // appear six times and never reach its per-clip cap. With 36 clips
      // available an edit came out using four, alternating two of them -- the
      // exact repetition this was supposed to prevent. The per-moment count
      // stops the same picture coming back; the per-clip count stops the same
      // SOURCE dominating, and it is the one a brief is talking about.
      const mkey = s.clip_id + "#" + s.shot + "#" + (s.moment || 0);
      if ((used.get(mkey) || 0) >= 1) continue;
      // The per-clip cap is a DIVERSITY control: it stops one clip dominating
      // a pool of many. When the pool is a single film -- a music video cut
      // into eighty shots -- it stops meaning that and starts meaning "this
      // film may be two shots long". language-film placed 2 shots and left 17
      // slots empty for exactly this reason. The shot-level counter below
      // still prevents showing the same shot twice, which is the thing anyone
      // actually notices.
      if (distinctClips > 1 && (used.get(s.clip_id) || 0) >= maxReuse) continue;
      const times = used.get(s.clip_id) || 0;
      // Can this shot supply the requested duration? Shots that cannot are
      // only considered when nothing else is left, and the caller is expected
      // to have capped `want` to what the footage can actually deliver -- a
      // 10.96-second clip placed in a 34.69-second slot is how the compiler
      // came to be handed an in-point past the end of its source.
      const have = s.duration;
      if (have + 0.02 < want) continue;
      // Prefer shots with room to spare, but do not prefer a 40-second shot
      // for a 1-second slot -- that is how a whole edit ends up inside one
      // clip.
      const room = Math.min(1, have / Math.max(0.2, want));
      // Mild, so that a shot is not reused three times in a row, but nowhere
      // near strong enough to drive the edit. It used to be a headline term.
      const fresh = 1 / (1 + times);
      // Continuity. Same world as the outgoing shot is what makes a sequence
      // read as one place rather than a slideshow. At a structural boundary the
      // caller passes allowKin and this term is dropped, so the picture changes
      // where the music does.
      const same = (kin && s.source_category === kin) ? 1 : 0;
      const cont = allowKin ? 0 : same;
      const jitter = ((Math.imul(hash(s.clip_id + ":" + s.shot + ":" + (s.moment || 0)),
                                 seed || 1) >>> 8) % 1000) / 1e5;
      // How striking this shot is, on its own terms: movement, a face, colour.
      const sub = maxSub > 0 ? Math.min(1, (s.subject_motion_px_s || 0) / maxSub) : 0;
      const face = s.faces ? 1 : 0;
      const alive = 0.55 * sub + 0.25 * face + 0.20 * Math.min(1, (s.saturation || 0) / 0.7);
      // Does this picture feel like this passage sounds? null when either side
      // has no opinion, and null is neutral rather than zero.
      // Same world, different subject. Continuity is about the WORLD -- water,
      // night, city -- and variety is about what is IN it. Without this,
      // matching the section's mood picked whichever content family best fits
      // "tender and euphoric" and put nine sandy beaches in thirteen shots:
      // coherent, and monotonous.
      let sameWord = 0;
      if (prevWord && semIdx) {
        const r0 = semIdx.get(s.clip_id + "#" + s.shot);
        if (r0 && r0.content_top && r0.content_top[0] === prevWord) sameWord = 1;
      }
      const mf = moodFit(s, sectionMood, semIdx);
      const mw = (brief.mood_weight === undefined) ? 0.0 : brief.mood_weight;
      const moodTerm = (mf === null) ? 0 : mw * (mf + 1) / 2;
      const base = s.fit * 0.42 + cont * 0.32 + room * 0.14 + fresh * 0.12;
      const varietyPenalty = sameWord * (brief.subject_variety === undefined
        ? 0.14 : brief.subject_variety);
      // WHERE IN THE FILM WE ARE. Every other term here is local -- does this
      // shot suit the brief, the mood, the shot before it. None of them knows
      // the piece is going anywhere, which is why the output was a montage that
      // landed on the beat rather than something with a shape. `storyWant` is
      // the picture energy the recipe asks for at this position; a shot that
      // does the wrong amount for this point in the film is penalised however
      // well it fits everything else.
      let storyTerm = 0;
      if (storyWant !== null && storyWant !== undefined) {
        const e = pictureEnergy(s, escale);
        storyTerm = -0.55 * Math.abs(e - storyWant);
      }
      // How much of the film's SUBJECT is in this shot, against how much the
      // recipe wants here. The cosine is already in the semantic index -- this
      // reads a measurement, it does not make one. Without it the product
      // appears at random and the piece has nothing to resolve.
      let arriveTerm = 0;
      if (subjectWant !== null && subjectWant !== undefined && subjWord && semIdx) {
        const row = semIdx.get(s.clip_id + "#" + s.shot);
        const cos = row && row.content ? row.content[subjWord] : undefined;
        if (cos !== undefined) {
          // Absolute CLIP cosines sit in a narrow band and mean nothing alone,
          // so they are ranked within the pool rather than thresholded.
          const rank = subjRank ? (subjRank.get(s.clip_id + "#" + s.shot) || 0.5) : 0.5;
          arriveTerm = -0.65 * Math.abs(rank - subjectWant);
        }
      }
      const score = (1 - mw) * ((1 - 0.45 * imp) * base + 0.45 * imp * alive)
                    + moodTerm - varietyPenalty + storyTerm + arriveTerm + jitter;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Where inside the chosen shot to start.
  //
  // This used to be the centre of whatever slack the shot had, which is a
  // defensible default and is not a decision. Re-cutting a finished
  // advertisement made the cost plain: its shots were built to be cut at a
  // particular frame of a movement, and entering one at its midpoint lands in
  // the middle of a gesture -- the picture is already halfway through doing
  // something when you arrive, and finishes before you leave.
  //
  // With a motion curve there is a better question: across the offsets this
  // shot allows, which one gives a window that ARRIVES relatively quiet and
  // then does something? That is what makes a cut feel placed rather than
  // merely timed. Falls back to centred when the shot has no curve.
  function inPoint(shot, want, opts) {
    const slack = Math.max(0, shot.duration - want);
    const centred = +(shot.start + slack / 2).toFixed(3);
    const curve = shot.motion_curve;
    if (!curve || curve.length < 4 || slack < 0.12) return centred;

    const n = curve.length;
    const at = function (tt) {                    // curve value at a time offset
      const k = Math.max(0, Math.min(n - 1, Math.floor(tt / shot.duration * n)));
      return curve[k];
    };
    const span = Math.max(0.05, want);
    let best = centred, bestScore = -1e9;
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const off = slack * (i / steps);
      let sum = 0, m = 0;
      for (let t2 = 0; t2 < span; t2 += span / 6) { sum += at(off + t2); m++; }
      const mean = m ? sum / m : 0;
      const rise = at(off + span * 0.85) - at(off + span * 0.15);
      const calmEntry = 1 - at(off);
      // Active, rising, and not already mid-gesture on the first frame.
      const score = mean * 0.5 + rise * 0.35 + calmEntry * 0.15;
      if (score > bestScore) { bestScore = score; best = +(shot.start + off).toFixed(3); }
    }
    return best;
  }

  function cohere(pool, radius, minKeep) {
    const withLook = pool.filter(function (s) {
      return Array.isArray(s.look) && s.look.length >= 12;
    });
    if (withLook.length < (minKeep || 8)) return pool;
    function dist(a, b) {
      let d = 0;
      for (let i = 0; i < a.look.length; i++) {
        const x = a.look[i] - b.look[i];
        d += x * x;
      }
      return Math.sqrt(d / a.look.length);
    }
    // Which cluster, not just the biggest one. Density alone picked "dark
    // things" -- a tape deck, three star fields and a train all measure dark
    // and share nothing else. Weighting by how well the members suit the brief
    // lets a brief that wants people and movement land on the cluster of
    // people moving rather than on the cluster of night sky.
    const r = radius || 0.16;
    let best = null, bestScore = -1;
    for (const c of withLook) {
      let n = 0, fitSum = 0;
      for (const o of withLook) {
        if (dist(c, o) <= r) { n++; fitSum += o.fit; }
      }
      if (n < 4) continue;
      const score = n * (fitSum / n) * (fitSum / n);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return pool;
    const kept = withLook.filter(function (s) { return dist(best, s) <= r; });
    return kept.length >= (minKeep || 8) ? kept : pool;
  }

  // The longest slot the footage can fill without repeating itself inside one
  // shot. A cut forced by this limit is NOT a musical decision and must never
  // be recorded as one -- see `footage-limit` in the policies.
  function longest(pool) {
    let m = 0;
    for (const s of pool) if (s.duration > m) m = s.duration;
    return m;
  }

  // Split any stretch longer than `cap`, preferring a real musical candidate
  // inside it and falling back to the grid. Returns the new edge list plus the
  // times that were forced, so the caller can label them honestly.
  // `cap` may be a number or a function of the stretch's start time, so that a
  // deliberate HOLD can be exempt from the brief's max_shot_s while still
  // obeying the footage limit. A hold is an explicit decision not to cut;
  // max_shot_s is a default about ordinary shots. Letting the default override
  // the decision is how a model's 29-second hold came back as four cuts.
  function capSlots(edges, cap, declined, snapTo) {
    const capAt = typeof cap === "function" ? cap : function () { return cap; };
    const out = [edges[0]], forced = [];
    for (let i = 1; i < edges.length; i++) {
      let a = out[out.length - 1];
      const b = edges[i];
      while (b - a > capAt(a)) {
        const cap = capAt(a);
        const inner = (declined || [])
          .filter(function (c) { return c.t > a + cap * 0.35 && c.t < Math.min(b, a + cap); })
          .sort(function (x, y) { return y.strength - x.strength; })[0];
        let t = inner ? inner.t : a + cap;
        t = snapTo ? snapTo(t) : t;
        if (!(t > a + 0.05) || t >= b - 0.05) { t = a + cap; }
        if (!inner) forced.push(t);
        out.push(+t.toFixed(3));
        a = out[out.length - 1];
      }
      out.push(b);
    }
    return { edges: Array.from(new Set(out)).sort(function (x, y) { return x - y; }),
             forced: forced };
  }

  return { fit: fit, shots: shots, choose: choose, inPoint: inPoint,
           hash: hash, longest: longest, capSlots: capSlots, cohere: cohere,
           subjectFit: subjectFit, semanticIndex: semanticIndex,
           selectBySubject: selectBySubject, moodFit: moodFit, moodAt: moodAt,
           pictureEnergy: pictureEnergy, energyScale: energyScale,
           subjectRanking: subjectRanking,
           orderedPool: orderedPool, orderIndexAt: orderIndexAt,
           nextInOrder: nextInOrder,
           PREFERABLE: PREFERABLE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ASSETS;
