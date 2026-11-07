/* DBETTER rewind core: a change tape. DuelingBook's own engine plays each replay entry once, under a virtual
   clock; every page (DOM) and DuelingBook JavaScript change it makes is recorded per play. Moving to a
   recorded position applies those changes backwards or forwards instead of replaying the duel. No network,
   no use of DuelingBook's snapshot functions, no extension APIs. Tied to DuelingBook's v932 replay page. */
(function(global) {
  'use strict';
  // DuelingBook v932's top-level variables (inline replay script, duel.js, utils.js), minus static catalogs
  // and lists that plays never change. The walk starts from these and follows players, cards and card data.
  const TRACKED = ["ABOUT_ZERO","AVATAR_START","Activate","Admanager","Attack","BLAH","BLINK","Banish","CARDS_START","CARD_IMAGES_START","CARD_START","CARD_TOKENS_START","CHROME","CONTENTSCALE","CUSTOM_PICS_START","CoinFlip","CoinStart","Continuous","CounterSound","Decided","Declare","DiceSound","DrawSound","EDGE","FIREFOX","FP1","FP2","FP3","FP4","FP5","FP6","FP7","FP8","FaceDown","Flip","IE","IMAGES_START","IMGBB_KEY","IMGUR_ID","LifePoints","LifePointsEnd","MAC","Move","NormalSummon","OPERA","Ok","PC","PERSPECTIVE","PROFILE_PIC_START","PartnerFound","Pinching","Placement1","Placement2","Placement3","Placement4","Reveal","SAFARI","SKILL_BACKS_START","SLEEVE_START","SOUND_START","Scope","ShowingMes4","ShowingPoints","Shred","ShuffleHand","ShuffleSound","SnapShot","SpecialSummon","SpeedDuelBanlist","Swap","Switch","TOKEN_START","TOR","TOUCHEND","TURNSTILE_KEY","Target","Timers","TurnChime","UPDATED_URL_START","URL_START","VERSION","Zoom","action_list","actionsQueue","active","active_player","active_scrollpane","adjudicator","adjustTimer","admin","admin_status","alignLeft","alignRight","all_cards_arr","all_status_arr","allowToBottom","always_show_nsfw","audio_arr","automatic","automaticTourney","awaiting_admin","awaiting_cards","awaiting_defeat","awaiting_start_turn","awaiting_token","banlists","banner_ad","blocked_arr","blue_stream","bottomChoice","bottomChoices","bp_btn","bubbles1","bubbles2","bubbles3","bubbles4","canAddMoreCards","cancel_callback","cardsInExtra","cardsInMain","cardsInSide","cards_created","cards_fingerprint","changing_components","combo_callback","conceal","contentScale","controlDown","controlFocus","countdownTimer","counter_btn","counters","currentLabel","currentPhase","data_arr","db_id","deckCardX","deckCardY","deckData","deck_arr","deck_filled_arr","dim","dimTimer","dislike","dp_btn","dragXOffset","dragYOffset","duelActions","duelChatTimer","duelChatTyping","duelDate","duelFocus","duelFormat","duelHash","duelId","duel_active","duel_links","duel_log","duel_log_vsp","duel_logs","duel_vsp","duelist","easeSeconds","easeSeconds2","easeSeconds3","easeSeconds4","easeSeconds5","easeSecondsBanish","ep_btn","extra_arr","extra_filled_arr","fancy_scrollbars","fast_forwarding","field_spell_counter","first","first_player","flat","gameLossSound","gameWinSound","game_number","games","gotoSeconds","handDestination","html","image_url","images","input_callback","isScrolling","item_arr","jello","key","lastAction","lastDuelId","left_link_counter","life_amount","life_bar","lifepointMax","linkLeft","linkLeftX","linkLeftxEnd","linkLeftxStart","linkRight","linkRightX","linkRightxEnd","linkRightxStart","linkY","links","loadkey","logTurnCount","logging","login_box","m1_btn","m1_counter","m2_btn","m2_counter","m3_counter","m4_counter","m5_counter","mainHeight","mainWidth","marginLeft","marginTop","master","match","match_number","match_type","menu","menu_card","menu_reason","mes1","mes2","mes3","mes4","mobile","moderator","mouseMoveTimer","mouseX","mouseXScaled","mouseY","mouseYScaled","msg_callback","no_callback","notification_tweening","opp_field_spell_counter","opp_m1_counter","opp_m2_counter","opp_m3_counter","opp_m4_counter","opp_m5_counter","opp_pendulum_left_counter","opp_pendulum_right_counter","opp_s1_counter","opp_s2_counter","opp_s3_counter","opp_s4_counter","opp_s5_counter","opp_skill_card_counter","paper1","paper2","password","paused","pausedBy","pendulum_left_counter","pendulum_right_counter","pickedRPS","player1","player2","player3","player4","players","preload_arr","prevFocus","prev_frames","prev_life","preview","previewTimer","preview_txt","preview_vsp","previous_plays","random_arr","rated","ready","recycled_cardfronts_arr","recycled_cards_arr","red_stream","regular","remember_me","remote","remove_menu_reason","replay","replay_arr","replay_loaded","resetting","resizeETimer","resume_play","right_link_counter","rock1","rock2","rpsTimer","rpsWinner","rush","s1_counter","s2_counter","s3_counter","s4_counter","s5_counter","scissors1","scissors2","screenshotStyle","search_arr","searching","second","seconds","seen_deck","seen_extra","selectedToken","shiftDown","shine","showMes","show_cards","shuffle_field_cards","sideHeight","sideWidth","side_arr","side_filled_arr","skill_card_counter","skinny_ad","skipping","solo","sp_btn","spark","speed","standings","startingHandSize","statuses_data","stopQueue","stopped","streaming","summoning_card","summoning_play","swfHeight","swfWidth","switched","tag_duel","taking_screenshot","testing1","testing2","topChoice","topChoices","tourneys_data","turnCount","turn_player","turnstileID","unknown_extra_total","unknown_main_total","unknown_totals","update_statuses","usecardimages","used_allotted_rematch","userId","username","version","viewing","viewing_card","viewing_card_with_materials","watch_chat","watch_chat_limit","watch_chat_vsp","watchers_data","watchers_vsp","yes_callback","zooming"];
  // Replay data and logs: compared as lists, never walked into (their entries are the replay's own records).
  const OPAQUE = new Set(['previous_plays', 'replay_arr', 'duel_logs']);
  let source = null, busy = false, last = null, session = null;
  // The virtual clock replaces performance.now; timings use the real one.
  const realNow = Performance.prototype.now.bind(performance);

  // ---- engine transaction pieces (as in the rebuild core) -------------------------------------------------
  function deferredUI() {
    const update=global.updateDuelLog, text=global.setText, cardText=global.setCardText, expand=global.expandAvatar;
    const saveScroll=global.saveDuelVSP, restoreScroll=global.restoreDuelVSP;
    let scrolled=false, dirty=false;
    const texts=new Map(), cardTexts=new Set();
    global.saveDuelVSP=()=>{};
    global.restoreDuelVSP=()=>{scrolled=true;};
    global.updateDuelLog=()=>{dirty=true;};
    global.setText=arg=>{const node=arg?.jquery?arg[0]:arg;if(node)texts.set(node,arg);};
    global.setCardText=node=>{if(node)cardTexts.add(node);};
    // expandAvatar fits a player's name (setText) and then turns it upright into the name box beside the avatar,
    // with a tween that reads the fitted scale: there the text is fitted first, as in normal playback.
    if(typeof expand==='function') global.expandAvatar=function(...args) {
      const deferred=global.setText; global.setText=text;
      try { return expand.apply(this,args); } finally { global.setText=deferred; }
    };
    // Texts are applied at every recorded boundary, so each play's entry holds its own text changes. The duel
    // log is derived from duel_logs and kept out of the tape: it is rendered once, when the transaction ends.
    const flush=()=>{
      for(const [node,arg] of texts) if(node.isConnected)text(arg);
      texts.clear();
      for(const node of cardTexts) if(node.isConnected)cardText(node);
      cardTexts.clear();
    };
    return {flush, restore() {
      global.updateDuelLog=update;global.setText=text;global.setCardText=cardText;
      if(typeof expand==='function') global.expandAvatar=expand;
      global.saveDuelVSP=saveScroll;global.restoreDuelVSP=restoreScroll;
      flush();
      if(dirty) renderLog();
      else if(scrolled) { global.duel_vsp=1e9; restoreScroll(); }
    }};
  }
  // DuelingBook re-renders the whole log (every line) from duel_logs on each update.
  function renderLog() {
    if(typeof global.updateDuelLog!=='function') return;
    global.updateDuelLog();
    if(typeof global.restoreDuelVSP==='function') { global.duel_vsp=1e9; global.restoreDuelVSP(); }
  }
  // A full render formats every line again, and cardsToLinks looks up each quoted name in the whole card list
  // (18,000 names): about 250 ms for a few hundred lines on the live page. Its result only depends on the line
  // and on that list, so each line is formatted once. Installed when a replay is captured, so DuelingBook's own
  // playback before the tape takes over fills it.
  function memoizeLinks() {
    const links=global.cardsToLinks;
    if(typeof links!=='function'||links.dbetterMemo) return;
    const cache=new Map(); let cards=-1;
    const memo=function(text) {
      const n=global.Cards?.length??-1;
      if(n!==cards) { cache.clear(); cards=n; }
      let html=cache.get(text);
      if(html===undefined) { html=links.call(this,text); cache.set(text,html); }
      return html;
    };
    memo.dbetterMemo=true;
    global.cardsToLinks=memo;
  }
  // After tape steps, once per frame: the board must not wait for the log.
  let logFrame=0;
  function renderLogSoon() {
    if(logFrame) return;
    logFrame=global.requestAnimationFrame(()=>{logFrame=0;renderLog();});
  }
  function virtualClock() {
    const saved = {}, tasks = new Map();
    const perfDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    let now = performance.now(), epoch = Date.now() - now, nextId = 1000000000;
    const initial = now;
    for (const k of ['setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame']) saved[k]=global[k];
    const oldNow=Date.now;
    const schedule=(fn, delay, repeat, args, raf=false)=> {
      const id=nextId++;
      tasks.set(id,{fn,at:now+Math.max(1,Number(delay)||0),repeat,args,raf}); return id;
    };
    global.setTimeout=(f,d,...a)=>schedule(f,d,0,a);
    global.setInterval=(f,d,...a)=>schedule(f,d,Math.max(1,Number(d)||0),a);
    global.requestAnimationFrame=f=>schedule(f,1000/60,0,[],true);
    global.clearTimeout=global.clearInterval=id=>{if(!tasks.delete(id))saved.clearTimeout.call(global,id);};
    global.cancelAnimationFrame=id=>{if(!tasks.delete(id))saved.cancelAnimationFrame.call(global,id);};
    Date.now=()=>epoch+now;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
    const animation=global.com.greensock.core.Animation;
    const ticker=TweenMax.ticker, roots=[animation._rootTimeline,animation._rootFramesTimeline];
    const tickerTime=ticker.time, tickerFrame=ticker.frame;
    ticker.sleep();
    const wake=ticker.wake;
    // New tweens auto-wake the ticker; its private wall-clock tick would re-enter the root render at an
    // earlier time and fire onStart a second time.
    ticker.wake=()=>ticker;
    function render() {
      ticker.time=tickerTime+(now-initial)/1000;
      ticker.frame++;
      ticker.dispatchEvent('tick');
    }
    const step = (ms=16.667) => {
      const end=now+ms;
      let count=0;
      // Each virtual task ends as a real one would: Watch.JS callbacks run before the next starts.
      watchers.flush();
      while (true) {
        let id, task;
        for (const [key,t] of tasks) if(t.at<=end && (!task || t.at<task.at)){id=key;task=t;}
        if(!task) break;
        if(++count>20000) throw Error('Virtual timer runaway');
        now=task.at;
        render(); watchers.flush();
        if(!tasks.has(id)) continue;
        if(task.repeat) task.at+=task.repeat; else tasks.delete(id);
        if(typeof task.fn==='function') task.fn(...(task.raf?[now]:task.args)); else (0,eval)(String(task.fn));
        watchers.flush();
      }
      now=end;
      // GSAP 2 caches Date.now at script load. Dispatch with virtual ticker time instead of tick(), whose
      // private cached clock still reads wall time.
      render(); watchers.flush();
    };
    return {step, next() {
      let delay=1000;
      for(const t of tasks.values()) delay=Math.min(delay,t.at-now);
      for(const t of finiteTweens()) {
        if(t.vars.onUpdate) {delay=Math.min(delay,16.667);continue;}
        const time=t._timeline._time;
        const edge=t._startTime>time+1e-7?t._startTime:t._startTime+t.totalDuration()/t._timeScale;
        delay=Math.min(delay,(edge-time)*1000+0.001);
      }
      return Math.max(0.001,delay);
    }, pending() {
      // One-shot timeouts still waiting (not intervals or animation frames).
      return [...tasks.values()].filter(t=>!t.repeat&&!t.raf).map(t=>({in:Math.round(t.at-now),fn:String(t.fn).replace(/\s+/g,' ').slice(0,160)}));
    }, get elapsed(){return now-initial;}, restore() {
      ticker.sleep();
      const delta=ticker.time-tickerTime, frames=ticker.frame-tickerFrame;
      roots[0]._startTime-=delta; roots[1]._startTime-=frames;
      ticker.time=tickerTime; ticker.frame=tickerFrame;
      ticker.wake=wake;
      Object.assign(global,saved); Date.now=oldNow;
      if(perfDescriptor) Object.defineProperty(performance,'now',perfDescriptor); else delete performance.now;
      ticker.wake(true);
    }};
  }
  function finiteTweens() {
    return TweenMax.getAllTweens().filter(t=>!t._paused && t._repeat!==-1 && t.totalDuration()<1e8 && !global.$(t.target?.[0]||t.target).hasClass('all_good'));
  }
  function settle(clock) {
    const start=clock.elapsed;
    do {
      clock.step(clock.next());
      if(clock.elapsed-start>120000) throw Error(`Forward queue stalled: ${JSON.stringify(status())}`);
    } while(global.actionsQueue.length || global.stopQueue || finiteTweens().length);
  }
  function reset() {
    global.timer.stop();
    // loadReplayComplete is a loader, not an exit routine. Clean the old duel first.
    if(global.player1?.all_cards_arr) { global.exitRPS(); global.exitTP(); global.exitDueling(); global.exitSiding(); }
    global.TweenMax.killAll();
    global.actionsQueue=[]; global.stopQueue=false; global.previous_plays=[];
    global.duel_logs=[]; global.GAMESTATES=[];
    global.gotoSeconds=0; global.skipping=false; global.fast_forwarding=false;
    global.ready=false; global.lastAction={}; global.currentPhase=undefined;
    // Card references DuelingBook only clears for some formats: back to their declared initial values, so a
    // second load in the same page starts as a fresh page does.
    global.linkLeft=undefined; global.linkRight=undefined; global.summoning_play=undefined;
    global.viewing_card_with_materials=undefined; global.menu_card=null;
    global.loadReplayComplete(source);
    global.pauseE();
  }
  // Activation sparks are SVG movies on their own timer; normal playback settles with none showing.
  const clearSparks=()=>document.querySelectorAll('#spark > svg').forEach(node=>node.remove());

  // ---- Watch.JS callbacks at virtual task boundaries -------------------------------------------------------
  // DuelingBook turns a card's inner face (card.onRotate: which side shows, and whether it is mirrored) and the
  // coin's picture from Watch.JS callbacks, which a MutationObserver delivers after every task. Recording runs
  // many virtual tasks inside one real task, so those callbacks would only arrive after the play they belong
  // to was recorded. The rewind takes the watched elements over with an equivalent observer that the virtual
  // clock flushes at each of its task boundaries; outside recording it delivers as Watch.JS does.
  const watchers=(()=>{
    const entries=new Map();     // element -> Watch.JS entries {props, vals, changed, callback}
    const observer=new MutationObserver(records=>deliver(records));
    let installed=false, errors=0, lastError='';
    const current=(el,prop)=>el.attributes[prop]||el.style[prop];
    function add(el, list) {
      let own=entries.get(el);
      if(!own) { entries.set(el,own=[]); observer.observe(el,{attributes:true}); }
      own.push(...list);
    }
    // Watch.JS keeps its entries on the element, with one observer per element; an emptied list leaves that
    // observer nothing to call.
    function adopt(el) { if(el?.watching?.length) { add(el,el.watching); el.watching=[]; } }
    function adoptCards() {
      for(const p of [global.player1,global.player2,global.player3,global.player4]) for(const c of p?.all_cards_arr||[]) adopt(c?.[0]);
      for(const c of global.recycled_cards_arr||[]) adopt(c?.[0]);
    }
    // As Watch.JS: once every watched property has changed, any attribute change calls back. One call per
    // element and delivery: the callbacks only read the element's current state.
    function deliver(records) {
      for(const el of new Set(records.map(r=>r.target))) for(const w of entries.get(el)||[]) {
        let all=true;
        for(let n=0;n<w.props.length;n++) { const v=current(el,w.props[n]); if(w.vals[n]!=v) { w.vals[n]=v; w.changed[n]=true; } }
        for(let n=0;n<w.props.length;n++) if(!w.changed[n]) { all=false; break; }
        if(all&&w.callback) try { w.callback.call(el); } catch(e) { errors++; lastError=String(e?.stack||e).slice(0,300); }
      }
    }
    return {
      install() {
        if(installed) return; installed=true;
        const watch=function(targets, props, options, callback) {
          if(typeof options==='function') callback=options;
          const names=String(props).split(' ');
          // Array-likes (jQuery objects) only, as Watch.JS.
          for(const el of Array.prototype.slice.call(targets)) add(el,[{props:names,vals:names.map(p=>current(el,p)),changed:names.map(()=>false),callback:typeof callback==='function'?callback:null}]);
          return this;
        };
        global.watch=function() { return watch.apply(arguments[0],arguments); };
        global.jQuery.fn.watch=function(...args) { return watch.apply(this,[this,...args]); };
        for(const el of document.getElementsByTagName('*')) adopt(el);
        adoptCards();
      },
      adoptCards,
      // A virtual task ended: deliver what it changed (callbacks can change watched elements again).
      flush() { for(let i=0;i<10;i++) { const r=observer.takeRecords(); if(!r.length) return; deliver(r); } },
      // A tape move restores the callbacks' effects with everything else.
      discard() { observer.takeRecords(); },
      status() { return {elements:entries.size,errors,lastError}; }
    };
  })();

  // ---- the viewer's hand setting -------------------------------------------------------------------------------
  // Hide Hands / Show Hand / Show Both (show_cards 0, 1, 2) is the viewer's choice, but DuelingBook turns hand cards
  // by it while it plays, so the tape holds them as recorded under the setting of the time. DuelingBook's radio
  // handler turns the current hand outside the tape, which leaves GSAP's transform cache of those cards disagreeing
  // with transforms the tape restores later. A change of setting therefore makes the tape stale: the next move
  // records the duel again, and DuelingBook turns every hand card by the new setting itself.
  let stale=false;
  document.addEventListener('change',event=>{ if(event.target?.name==='show'&&!busy&&session) stale=true; });

  // ---- sounds --------------------------------------------------------------------------------------------------
  // What DuelingBook plays during a play, with its virtual time from the play's start. Recording keeps them silent;
  // the timeline plays them again when it moves forward through that play.
  const sounds={list:null,clock:null,start:0,
    play(args) { this.list?.push({at:Math.round(this.clock.elapsed-this.start),args}); },
    begin(clock) { this.list=[]; this.clock=clock; this.start=clock.elapsed; },
    end() { const list=this.list; this.list=null; this.clock=null; return list?.length?list:null; }};

  // ---- JavaScript state: values of DuelingBook's globals and of every object reachable from them ----------
  function jsTracker() {
    const expando=global.jQuery.expando, PRIV=expando+'1', USER=expando+'2';
    const SVGAnimC=global.SVGAnim, Animation=global.com?.greensock?.core?.Animation;
    const plain=new Set([Object.prototype, Array.prototype, null, global.jQuery.fn]);
    const shadow=new Map();            // object -> {keys, vals} or array copy (arrays)
    const globals=new Map();           // name -> value
    const opaque=new Set();            // arrays compared as lists only
    const names=TRACKED.filter(n=>n in global);
    const skipValue=v=>(SVGAnimC&&v instanceof SVGAnimC)||(Animation&&v instanceof Animation);
    function walkable(v) {
      if(v===null||typeof v!=='object'||skipValue(v)) return false;
      if(v instanceof Node) return v.nodeType===1;
      return plain.has(Object.getPrototypeOf(v));
    }
    function record(v, list) {
      if(Array.isArray(v)) return v.slice();
      const keys=Object.keys(v), vals=new Array(keys.length);
      for(let i=0;i<keys.length;i++) vals[i]=v[keys[i]];
      return {keys,vals};
    }
    // Discover v and everything new reachable from it.
    function discover(v, out) {
      const stack=[v];
      while(stack.length) {
        const o=stack.pop();
        if(shadow.has(o)) continue;
        const snap=record(o);
        shadow.set(o,snap);
        if(opaque.has(o)) continue;
        const vals=Array.isArray(snap)?snap:snap.vals;
        if(o instanceof Element) {
          tracker.onElement?.(o);
          // An element's own JavaScript properties: jQuery data, GSAP's transform cache, DuelingBook fields.
          // jQuery's private store (event handlers) is left out: plays don't rebind handlers.
          for(let i=0;i<snap.keys.length;i++) { const x=snap.vals[i]; if(x&&typeof x==='object'&&snap.keys[i]!==PRIV&&!shadow.has(x)&&(walkable(x)||snap.keys[i]==='_gsTransform')) stack.push(x); }
          continue;
        }
        for(const x of vals) if(walkable(x)&&!shadow.has(x)) stack.push(x);
        if(out) out.push(o);
      }
    }
    function sweepElements(root) {
      // Duel elements DuelingBook gave data or transforms to without our roots reaching them (zones, counters…).
      const duel=document.getElementById('duel')||root;
      for(const el of duel.getElementsByTagName('*')) if(!shadow.has(el)&&(el[USER]!==undefined||el._gsTransform!==undefined)) discover(el);
    }
    function start(root) {
      for(const n of names) {
        const v=global[n]; globals.set(n,v);
        if(OPAQUE.has(n)&&Array.isArray(v)) opaque.add(v);
        if(typeof v==='function') continue;
        if(walkable(v)) discover(v);
      }
      sweepElements(root);
    }
    // Changes since the last call, as undo/redo records; the shadow moves to the current state.
    function diff(root) {
      const changes=[];
      for(const n of names) {
        const v=global[n], old=globals.get(n);
        if(v===old||typeof v==='function'||(typeof v==='number'&&v!==v&&old!==old)) continue;
        if(skipValue(v)&&(old===undefined||skipValue(old))) { globals.set(n,v); continue; }
        changes.push({g:n,old,val:v}); globals.set(n,v);
        if(OPAQUE.has(n)&&Array.isArray(v)) opaque.add(v);
        if(walkable(v)&&!shadow.has(v)) discover(v);
      }
      for(const [o,snap] of shadow) {
        if(Array.isArray(snap)) {
          const n=o.length;
          let same=n===snap.length;
          for(let i=0;same&&i<n;i++) if(o[i]!==snap[i]) same=false;
          if(same) continue;
          const now=o.slice();
          changes.push(listChange(o,snap,now));
          shadow.set(o,now);
          if(!opaque.has(o)) for(const x of now) if(walkable(x)&&!shadow.has(x)) discover(x);
          continue;
        }
        const keys=Object.keys(o);
        let same=keys.length===snap.keys.length;
        for(let i=0;same&&i<keys.length;i++) if(keys[i]!==snap.keys[i]||o[keys[i]]!==snap.vals[i]) same=false;
        if(same) continue;
        const now=record(o), prev=new Map(snap.keys.map((k,i)=>[k,snap.vals[i]]));
        const props=[];
        for(let i=0;i<now.keys.length;i++) {
          const k=now.keys[i], v=now.vals[i];
          if(prev.has(k)) { if(prev.get(k)!==v) props.push([k,true,prev.get(k),true,v]); prev.delete(k); }
          else props.push([k,false,undefined,true,v]);
          if(v&&typeof v==='object'&&k!==PRIV&&!shadow.has(v)&&(walkable(v)||(o instanceof Element&&k==='_gsTransform'))) discover(v);
        }
        for(const [k,v] of prev) props.push([k,true,v,false,undefined]);
        changes.push({o,props,keysBefore:snap.keys,keysAfter:now.keys});
        shadow.set(o,now);
      }
      if(root) sweepElements(root);
      return changes;
    }
    // Lists DuelingBook trims from the front and appends to are stored as that, not as copies.
    function listChange(o,before,after) {
      let f=before.length&&after.length?before.indexOf(after[0]):-1;
      if(after.length===0) f=before.length;
      if(f>=0) {
        let ok=true; const kept=before.length-f;
        if(kept>after.length) ok=false;
        for(let i=0;ok&&i<kept;i++) if(before[f+i]!==after[i]) ok=false;
        if(ok) return {a:o,removed:before.slice(0,f),added:after.slice(kept)};
      }
      return {a:o,before,after};
    }
    const tracker={start,diff,size:()=>shadow.size,onElement:null};
    return tracker;
  }
  // Something outside the tape changed what a move is about to undo or redo (DuelingBook's pile viewers rewrite
  // counters and move cards; a viewer can reorder a pile). The move then records the duel again (seek). The
  // first thing found changed is kept for reports (status().lastBroken).
  let broken=false, lastBroken=null;
  const describe=n=>!n?'none':n.nodeType===3?`text "${n.data.slice(0,24)}"`:n.nodeType!==1?String(n.nodeName):
    (n.id?'#'+n.id:n.nodeName.toLowerCase())+(typeof n.className==='string'&&n.className.trim()?'.'+n.className.trim().split(/\s+/).slice(0,2).join('.'):'')+(global.jQuery?.(n).data?.('id')!=null?`[card ${global.jQuery(n).data('id')}]`:'');
  const fail=what=>{ if(!broken) lastBroken={...what,position:global.previous_plays?.length}; broken=true; };
  const detach=(r,n)=>{ if(n.parentNode===r.t) r.t.removeChild(n); else fail({node:describe(n),from:describe(r.t),now:describe(n.parentNode)}); };
  const same=(a,from,list)=>{ for(let i=0;i<list.length;i++) if(a[from+i]!==list[i]) return false; return true; };
  const listFail=(a,list)=>fail({list:a.length,expected:list.length,first:list[0]?.[0]?describe(list[0][0]):typeof list[0]});
  function applyJS(changes, backwards) {
    const order=backwards?changes.slice().reverse():changes;
    for(const c of order) {
      if(c.g) { global[c.g]=backwards?c.old:c.val; continue; }
      if(c.a) {
        const a=c.a;
        if(c.removed) {
          if(backwards) { if(!same(a,a.length-c.added.length,c.added)) listFail(a,c.added); a.splice(a.length-c.added.length,c.added.length); a.unshift(...c.removed); }
          else { if(!same(a,0,c.removed)) listFail(a,c.removed); a.splice(0,c.removed.length); a.push(...c.added); }
        } else { const v=backwards?c.before:c.after; a.length=0; for(let i=0;i<v.length;i++) a[i]=v[i]; }
        continue;
      }
      const o=c.o;
      for(const [k,had,old,has,val] of c.props) {
        const [present,value]=backwards?[had,old]:[has,val];
        if(present) o[k]=value; else delete o[k];
      }
      // Restore key order too: DuelingBook and jQuery iterate data objects.
      const order2=backwards?c.keysBefore:c.keysAfter;
      if(!(o instanceof Element)&&!Array.isArray(o)&&Object.keys(o).join('\u0001')!==order2.join('\u0001')) {
        const vals=order2.map(k=>o[k]); for(const k of order2) delete o[k]; order2.forEach((k,i)=>{o[k]=vals[i];});
      }
    }
  }

  // ---- DOM: a MutationObserver over the page body; entries keep first old and final new values ------------
  function domTracker(root) {
    const observer=new MutationObserver(()=>{});
    const options={subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true,characterDataOldValue:true};
    // Elements DuelingBook holds in JavaScript are observed directly as well: it recycles cards and edits them
    // while they are detached, where an observer on the page body cannot see them.
    const watched=new Set(); let active=false;
    // Labels are kept by what they read, not by which nodes they hold: the pile counters and the monster zones'
    // ATK/DEF. DuelingBook rewrites them outside plays too, with new nodes (its pile viewers recount a pile and
    // redraw the field stats on closing), and later node changes would not find the nodes they recorded. Every
    // change inside them is kept this way, so none is recorded both ways. Read when recording starts and after
    // each play.
    const labels=new Map();
    const readLabels=()=>{
      labels.clear();
      for(const el of document.querySelectorAll('#field_stats > span, [id^="ci"][id$="_txt"]'))
        if(el.parentElement.id==='field_stats'||/^ci[dbegh]\d_txt$/.test(el.id)) labels.set(el,el.innerHTML);
    };
    const inLabel=n=>{ for(;n;n=n.parentNode) if(labels.has(n)) return true; return false; };
    return {
      watch(el) { if(watched.has(el)) return; watched.add(el); if(active) observer.observe(el,options); },
      start() { observer.observe(root,options); for(const el of watched) observer.observe(el,options); readLabels(); active=true; },
      stop() { observer.takeRecords(); observer.disconnect(); active=false; },
      take() {
        const attrs=new Map(), texts=new Map(), tree=[];
        // Interface, not game state: the log is rendered from duel_logs after each jump; the card preview keeps
        // whatever was last shown (its card front caches inner elements in private variables the tape can't see).
        // In duels and replays the preview is #duel > .preview with #preview_txt beside it, not #preview: DBETTER's
        // card-text links rewrite that text outside plays (user report, 2026-10-28: a re-record at every move).
        const skip=[...document.querySelectorAll('#duel_log,#preview,#duel>.preview,#preview_txt')];
        for(const r of observer.takeRecords()) {
          if(skip.some(x=>x.contains(r.target))) continue;
          if(r.type==='attributes') {
            let m=attrs.get(r.target); if(!m) attrs.set(r.target,m=new Map());
            const key=(r.attributeNamespace||'')+'|'+r.attributeName;
            if(!m.has(key)) m.set(key,{ns:r.attributeNamespace,name:r.attributeName,old:r.oldValue});
          } else if(inLabel(r.target)) continue;
          else if(r.type==='characterData') { if(!texts.has(r.target)) texts.set(r.target,{old:r.oldValue}); }
          else tree.push({t:r.target,add:[...r.addedNodes],rem:[...r.removedNodes],prev:r.previousSibling,next:r.nextSibling});
        }
        const attrList=[];
        for(const [node,m] of attrs) for(const a of m.values()) {
          const cur=a.ns?node.getAttributeNS(a.ns,a.name):node.getAttribute(a.name);
          if(cur!==a.old) attrList.push([node,a.ns,a.name,a.old,cur]);
        }
        const textList=[];
        for(const [node,t] of texts) if(node.data!==t.old) textList.push([node,t.old,node.data]);
        const labelList=[];
        for(const [el,old] of labels) { const cur=el.innerHTML; if(cur!==old) { labelList.push([el,old,cur]); labels.set(el,cur); } }
        return {tree,attrs:attrList,texts:textList,labels:labelList};
      }
    };
  }
  function setAttr(node,ns,name,value) {
    if(value===null) ns?node.removeAttributeNS(ns,name):node.removeAttribute(name);
    else ns?node.setAttributeNS(ns,name,value):node.setAttribute(name,value);
  }
  function applyDOM(e, backwards) {
    const anchor=r=>r.next&&r.next.parentNode===r.t?r.next:(r.prev&&r.prev.parentNode===r.t?r.prev.nextSibling:null);
    if(backwards) {
      for(let i=e.tree.length-1;i>=0;i--) {
        const r=e.tree[i];
        for(const n of r.add) detach(r,n);
        const ref=anchor(r); for(const n of r.rem) r.t.insertBefore(n,ref);
      }
      for(const [node,ns,name,old] of e.attrs) setAttr(node,ns,name,old);
      for(const [node,old] of e.texts) node.data=old;
      for(const [el,old] of e.labels) el.innerHTML=old;
    } else {
      for(const r of e.tree) {
        for(const n of r.rem) detach(r,n);
        const ref=anchor(r); for(const n of r.add) r.t.insertBefore(n,ref);
      }
      for(const [node,ns,name,,cur] of e.attrs) setAttr(node,ns,name,cur);
      for(const [node,,cur] of e.texts) node.data=cur;
      for(const [el,,cur] of e.labels) el.innerHTML=cur;
    }
  }
  // Several plays at once (jumps, scrubbing): structure changes run in order, but each attribute, text and
  // property is written once, with the value it has at the destination. Entries are in application order.
  function applyMerged(entries, backwards) {
    const anchor=r=>r.next&&r.next.parentNode===r.t?r.next:(r.prev&&r.prev.parentNode===r.t?r.prev.nextSibling:null);
    const attrs=new Map(), texts=new Map(), labels=new Map(), globals=new Map(), props=new Map(), orders=new Map();
    for(const e of entries) {
      const tree=e.dom.tree;
      if(backwards) for(let i=tree.length-1;i>=0;i--) {
        const r=tree[i];
        for(const n of r.add) detach(r,n);
        const ref=anchor(r); for(const n of r.rem) r.t.insertBefore(n,ref);
      } else for(const r of tree) {
        for(const n of r.rem) detach(r,n);
        const ref=anchor(r); for(const n of r.add) r.t.insertBefore(n,ref);
      }
      for(const [node,ns,name,old,cur] of e.dom.attrs) { let m=attrs.get(node); if(!m) attrs.set(node,m=new Map()); m.set((ns||'')+'|'+name,[ns,name,backwards?old:cur]); }
      for(const [node,old,cur] of e.dom.texts) texts.set(node,backwards?old:cur);
      for(const [el,old,cur] of e.dom.labels) labels.set(el,backwards?old:cur);
      const js=backwards?e.js.slice().reverse():e.js;
      for(const c of js) {
        if(c.g) { globals.set(c.g,backwards?c.old:c.val); continue; }
        if(c.a) { applyJS([c],backwards); continue; }      // list edits are relative: keep their order
        let m=props.get(c.o); if(!m) props.set(c.o,m=new Map());
        for(const [k,had,old,has,val] of c.props) m.set(k,backwards?[had,old]:[has,val]);
        orders.set(c.o,backwards?c.keysBefore:c.keysAfter);
      }
    }
    for(const [node,m] of attrs) for(const [ns,name,value] of m.values()) setAttr(node,ns,name,value);
    for(const [node,value] of texts) node.data=value;
    for(const [el,value] of labels) el.innerHTML=value;
    for(const [n,v] of globals) global[n]=v;
    for(const [o,m] of props) {
      for(const [k,[present,value]] of m) { if(present) o[k]=value; else delete o[k]; }
      const order=orders.get(o);
      if(!(o instanceof Element)&&Object.keys(o).join('\u0001')!==order.join('\u0001')) {
        const vals=order.map(k=>o[k]); for(const k of order) delete o[k]; order.forEach((k,i)=>{o[k]=vals[i];});
      }
    }
  }

  // ---- sessions: one recorded tape per load of the replay --------------------------------------------------
  // DBETTER listens to these: 'rebuild' is a fresh load of the duel, 'record' continues from the furthest
  // recorded play. Moves along the tape run no DuelingBook code and send 'dbetter-tape' instead.
  function transaction(mode, fn) {
    if(busy) throw Error('Rewind already running');
    busy=true; global.DBETTERRebuilding=true;
    const log=console.log, sound=global.playSound, save=global.saveGamestate, rotationY=global.getRotationY;
    let clock, ui;
    try {
      global.dispatchEvent(new CustomEvent('dbetter-rebuild-begin',{detail:{mode}}));
      console.log=()=>{}; global.playSound=(...args)=>sounds.play(args);
      // endAction still calls the unfinished native snapshot builder. The tape has no use for it.
      global.saveGamestate=()=>{};
      watchers.install(); watchers.adoptCards(); memoizeLinks();
      // DuelingBook reads a card's Y rotation back from computed style (getRotationY: 90·(1 − m33)), which makes
      // the browser recalculate styles across the page: about half of each play's cost on the live page. GSAP's
      // cache of the transform it wrote gives the same value, at the 6 significant digits computed style reports
      // (and 0 where that shows 0). Elements outside the page, which report no transform, still go to DuelingBook.
      if(typeof rotationY==='function') global.getRotationY=el=>{
        const t=el?._gsTransform;
        if(!t||!el.isConnected) return rotationY(el);
        const m33=Number((Math.cos((t.rotationX||0)*Math.PI/180)*Math.cos((t.rotationY||0)*Math.PI/180)*(t.scaleZ??1)).toPrecision(6));
        return Math.abs(m33)<1e-6?0:-((m33*360-360)/4);
      };
      // The page stays visible: DuelingBook reads computed styles while it plays (getRotationY decides which face
      // of a card shows, name labels are measured to fit), and a hidden page reports no transforms or sizes.
      ui=deferredUI(); clock=virtualClock();
      return fn(clock, ui);
    } finally {
      try { try { global.pauseE(); } finally {
        try { ui?.restore(); } finally { clock?.restore(); }
      } }
      finally { console.log=log; global.playSound=sound; global.saveGamestate=save; if(typeof rotationY==='function') global.getRotationY=rotationY;
        try { restoreViewer(); }
        finally { busy=false; global.DBETTERRebuilding=false; global.dispatchEvent(new CustomEvent('dbetter-rebuild-end',{detail:{mode}})); } }
    }
  }
  // One play forward; false at the end of the replay. DuelingBook drops some entries without playing them, so
  // the end can come before the entry count says.
  function playOne(clock, ui) {
    let attempts=0;
    const before=global.previous_plays.length;
    while(global.previous_plays.length===before) {
      if(!global.replay_arr.length) return false;
      global.seconds=Number(global.replay_arr[0].seconds||0)-0.5;
      global.timerE(); settle(clock);
      if(global.previous_plays.length===before&&++attempts>100) throw Error(`Replay stalled: ${JSON.stringify(status())}`);
    }
    ui.flush(); clearSparks();
    return true;
  }
  const profile={engine:0,dom:0,js:0,plays:0,applyDom:0,applyJs:0,applied:0,broken:0};
  function record(s, target, clock, ui) {
    s.js.diff(); s.dom.start();                          // absorb changes made outside recording
    try {
      while(global.previous_plays.length<target) {
        sounds.begin(clock);
        const t0=realNow(); if(!playOne(clock, ui)) { s.ended=true; break; }
        const t1=realNow(); const dom=s.dom.take();
        const t2=realNow(); const js=s.js.diff(s.root);
        const t3=realNow();
        profile.engine+=t1-t0; profile.dom+=t2-t1; profile.js+=t3-t2; profile.plays++;
        s.tape.push({dom,js,sounds:sounds.end()});
      }
    } finally { s.dom.stop(); sounds.end(); }
    s.cursor=global.previous_plays.length; s.list=global.previous_plays;
    // What DuelingBook actually played up to the furthest recorded position, and the entries still ahead of it.
    s.played=global.previous_plays.slice(); s.ahead=global.replay_arr.slice();
  }
  function newSession(target) {
    return transaction('rebuild',(clock, ui)=>{
      stale=false; reset(); settle(clock); ui.flush(); clearSparks();
      const root=document.body;
      const s={root,tape:[],base:global.previous_plays.length,cursor:global.previous_plays.length,list:global.previous_plays,js:jsTracker(),dom:domTracker(root)};
      s.js.onElement=el=>s.dom.watch(el);
      s.js.start(root); session=s;
      record(s, target, clock, ui);
      return {mode:'rebuild',plays:s.tape.length};
    });
  }
  function consistent(s) { return s&&!stale&&global.previous_plays===s.list&&global.previous_plays.length===s.cursor&&!busy; }
  // False when the page or a list had changed outside the tape; the caller then records the duel again.
  function applyTo(s, target) {
    const from=s.cursor;
    global.DBETTERRebuilding=true; broken=false;
    try {
      const back=target<s.cursor, a=realNow();
      const entries=back?s.tape.slice(target-s.base,s.cursor-s.base).reverse():s.tape.slice(s.cursor-s.base,target-s.base);
      if(entries.length===1) { applyDOM(entries[0].dom,back); applyJS(entries[0].js,back); }
      else if(entries.length) applyMerged(entries,back);
      watchers.discard();
      if(entries.length) renderLogSoon();
      profile.applyDom+=realNow()-a; profile.applied+=entries.length; s.cursor=target;
      if(broken) profile.broken++;
      return !broken;
    } finally { s.list=global.previous_plays; global.DBETTERRebuilding=false; if(from!==s.cursor) global.dispatchEvent(new CustomEvent('dbetter-tape',{detail:{from,to:s.cursor}})); }
  }
  // A pile viewer the user opened holds the pile's cards in its own container, where a move would not find them
  // (replays never open one). A move sets it aside: DuelingBook puts the cards back as it closes, and afterwards
  // it opens again on that pile as it is then, the way DuelingBook's own playback refreshes it. A recording
  // reopens it before announcing its end, so DBETTER's card fan stays up instead of closing and opening again.
  let aside='';
  // The pile a viewer title shows, as DuelingBook's viewingE reads it; null for viewers tied to a moment
  // (picking cards, Xyz Materials, a partial Deck).
  function viewedPile(title) {
    const own=String(title).replace(/^Opponent's /,''), key={'Graveyard':'grave_arr','Banished':'banished_arr','Extra Deck':'extra_arr','Public Extra Deck':'extra_arr','Deck':'main_arr'}[own];
    if(!key) return null;
    const p=key==='grave_arr'||key==='banished_arr'?global.player1:global.Player1?.();
    return (own===title?p:p?.opponent)?.[key]||null;
  }
  function setViewerAside() {
    if(aside||!global.viewing||typeof global.exitViewing!=='function') return;
    aside=global.viewing; global.exitViewing();
  }
  function restoreViewer() {
    const viewed=aside; aside='';
    if(viewed&&!global.viewing&&viewedPile(viewed)?.length) global.viewingE?.(viewed);
  }
  function seek(target, options={}) {
    if(source===null) throw Error('Capture replay JSON before seeking');
    if(!Number.isSafeInteger(target)||target<0) throw RangeError('Position must be a nonnegative integer');
    setViewerAside();
    try {
      const start=performance.now();
      let s=session, info;
      if(!consistent(s)||target<s.base) info=newSession(target);
      else {
        const end=s.base+s.tape.length;
        // The engine only ever continues from the furthest recorded position. Card fronts keep lazily created
        // inner elements in private variables, which only agree with the page there.
        const from=s.cursor;
        if(target<=end) info=applyTo(s,target)?{mode:'tape',plays:Math.abs(target-from)}:newSession(target);
        else if(s.ended) info=applyTo(s,end)?{mode:'tape',plays:Math.abs(end-from)}:newSession(target);
        else if(!applyTo(s,end)) info=newSession(target);
        else {
          const recorded=s.cursor;
          info=transaction('record',(clock,ui)=>{record(s,target,clock,ui);return {mode:'record',plays:s.cursor-recorded};});
        }
      }
      global.pauseE?.();
      last={position:global.previous_plays.length,...info,ms:performance.now()-start,recorded:session?session.base+session.tape.length:0};
      return {...last};
    } finally { restoreViewer(); }
  }
  function invisible(play) {
    return (global.FAST_PLAYS||[]).concat(global.PLAYS_TO_SPEED_UP_WHEN_REWINDING||[]).includes(play) || play?.startsWith('View');
  }
  function stepBack(n=1) {
    if(!Number.isSafeInteger(n)||n<0)throw RangeError('Step count must be a nonnegative integer');
    let target=global.previous_plays.length;
    while(n-->0 && target>0) {
      while(target>0 && invisible(global.previous_plays[target-1].play)) target--;
      if(target>0)target--;
      while(target>0 && invisible(global.previous_plays[target-1].play)) target--;
    }
    return seek(target);
  }
  function seekTurnStart() {
    const history=global.previous_plays;
    // A boundary is AFTER the native turn-start action. Strictly earlier also makes a click at that boundary
    // select the preceding turn.
    for(let i=history.length-2;i>=0;i--) {
      if(['Start turn','Pick first','Pick second'].includes(history[i].play))return seek(i+1);
    }
    return seek(0);
  }
  function status() {
    return {captured:source!==null,busy,position:global.previous_plays?.length||0,remaining:global.replay_arr?.length||0,label:global.currentLabel,
      queue:global.actionsQueue?.length,stopQueue:global.stopQueue,ready:global.ready,last,
      tape:session?{base:session.base,recorded:session.base+session.tape.length,ended:!!session.ended,cursor:session.cursor,consistent:consistent(session),objects:session.js.size()}:null,profile:{...profile},lastBroken,watchers:watchers.status()};
  }
  global.DBRewind=Object.freeze({capture(str) {
    const data=JSON.parse(str);
    if(typeof str!=='string'||!data.player1||!data.player2||!Array.isArray(data.plays)||!data.plays.length) throw TypeError('Expected replay JSON with players and plays');
    source=str; session=null; memoizeLinks(); return {bytes:str.length};
  },seek,stepBack,seekTurnStart,status,
  history() { return session?{played:session.played||[],ahead:session.ended?[]:(session.ahead||[]),ended:!!session.ended}:null; },
  // The recorded sounds of the play that ends at this position: [{at: ms from the play's start, args}], or [].
  effects(position) { const entry=session?.tape[position-session.base-1]; return {sounds:entry?.sounds||[]}; }});
})(window);
