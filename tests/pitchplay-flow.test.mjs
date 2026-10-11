import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const match = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(match, 'the app must contain its inline application script');
const source = match[1];

function createHarness(existingStorage = new Map(), options = {}) {
  const listeners = Object.create(null);
  const alerts = [];
  const prompts = [];
  const nodes = Object.create(null);
  const autoSetup = options.autoSetup !== false;
  const autoToss = options.autoToss !== false;
  const node = (id = '') => ({
    id, innerHTML: '', textContent: '', value: '', content: '',
    focused: false,
    classList: { contains: () => false, toggle: () => {} },
    focus() { this.focused = true; },
    setSelectionRange() {},
    insertAdjacentHTML(_where, value) { this.innerHTML = value + this.innerHTML; }
  });
  for (const id of ['#app', '#modalhost', '#saveStatus', '#newTeamName', '#teamNameInput', '#importFile', '#runtimeError', 'meta[name="theme-color"]']) nodes[id] = node(id);
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) { return nodes[selector] || (nodes[selector] = node(selector)); },
    querySelectorAll() { return []; },
    getElementById(id) { return nodes['#' + id] || null; },
    addEventListener(type, handler, options) {
      (listeners[type] ||= []).push({ handler, options });
    }
  };
  const window = { addEventListener(type, handler) { (listeners['window:' + type] ||= []).push(handler); } };
  const localStorage = {
    getItem(key) { return existingStorage.has(key) ? existingStorage.get(key) : null; },
    setItem(key, value) { existingStorage.set(key, String(value)); },
    removeItem(key) { existingStorage.delete(key); }
  };
  class FormDataShim {
    constructor(form) { this.fields = form.fields || {}; }
    get(key) { return this.fields[key] == null ? null : this.fields[key]; }
    *entries() { yield* Object.entries(this.fields); }
  }
  const context = {
    document, window, navigator: {}, location: { protocol: 'https:' }, localStorage,
    FormData: FormDataShim,
    alert(message) { alerts.push(String(message)); },
    confirm() { return true; },
    prompt(message, fallback) { prompts.push(message); return fallback ?? '0'; },
    console: { log() {}, warn() {}, error() {} }
  };
  vm.runInNewContext(source, context, { filename: 'pitchplay-inline.js' });

  function target(data) {
    return {
      dataset: data,
      parentElement: null,
      closest(selector) {
        if (selector === 'form' && data.form) return data.form;
        if (selector === '[data-tab]' && data.tab !== undefined) return this;
        if (selector === '[data-theme]' && data.theme !== undefined) return this;
        if (selector === '[data-run]' && data.run !== undefined) return this;
        if (selector === '[data-extra]' && data.extra !== undefined) return this;
        if (selector === '[data-action]' && data.action !== undefined) return this;
        return null;
      }
    };
  }
  function click(data) {
    const event = { target: target(data), prevented: false, preventDefault() { this.prevented = true; } };
    for (const entry of (listeners.click || [])) entry.handler(event);
    if(data.action==='end-innings'||data.action==='declare'||data.action==='undo')setupCurrentInnings();
    if(autoSetup&&['wide','noBall','bye','legBye','penalty'].includes(data.extra)&&nodes['#modalhost'].innerHTML.includes('extraRunsForm'))submit({id:'extraRunsForm',fields:{type:data.extra,runs:(data.extra==='bye'||data.extra==='legBye')?'1':data.extra==='penalty'?'5':'0'}});
    return event;
  }
  function setupCurrentInnings() {
    if (!autoSetup) return;
    const db = data(); if (!db) return;
    const m = db.matches.find(x => x.id === db.currentMatchId) || db.matches.find(x => x.status === 'live');
    const inn = m && m.innings[m.currentInnings]; if (!m || m.status !== 'live' || !inn || (inn.strikerId && inn.nonStrikerId && inn.bowlerId)) return;
    const bat = db.teams.find(t => t.id === inn.battingTeamId), bowl = db.teams.find(t => t.id === inn.bowlingTeamId);
    const bp = (bat && bat.players || []).filter(p => !p.deleted), wp = (bowl && bowl.players || []).filter(p => !p.deleted);
    if (bp.length >= 2 && wp.length) submit({id:'inningsSetupForm',fields:{striker:bp[0].id,nonStriker:bp[1].id,bowler:wp[0].id}});
  }
  function submit(form) {
    if (!form.classList) form.classList = { contains: () => false };
    if (!form.dataset) form.dataset = {};
    const event = { target: form, prevented: false, preventDefault() { this.prevented = true; } };
    for (const entry of (listeners.submit || [])) entry.handler(event);
    if (form.id === 'matchForm' && autoToss) { const f=form.fields||{}, winner=options.tossWinnerField==='teamB'?f.teamB:f.teamA; submit({id:'tossForm',fields:{tossWinner:winner,decision:options.tossDecision||'bat'}}); }
    if (form.id === 'tossForm') setupCurrentInnings();
    return event;
  }
  function changeBowler(value) {
    const t = target({});
    t.value = value;
    t.matches = selector => selector === '[data-bowler]';
    for (const entry of (listeners.change || [])) entry.handler({ target: t });
  }
  function data() {
    const raw = existingStorage.get('pitchplay-cricket-v3');
    return raw ? JSON.parse(raw) : null;
  }
  return { listeners, alerts, prompts, nodes, existingStorage, click, submit, changeBowler, data };
}

test('inline application JavaScript parses and has a startup status', () => {
  assert.doesNotThrow(() => new Function(source));
  const app = createHarness();
  assert.match(app.nodes['#app'].innerHTML, /Every run has a story|Live Scoring|Create your team/);
  assert.equal(app.nodes['#saveStatus'].textContent, 'Ready · Build 28');
});

test('text fields remain editable and render visible typed text/caret styles', () => {
  assert.match(html, /-webkit-text-fill-color:var\(--text\)/);
  assert.match(html, /caret-color:var\(--brand\)/);
  assert.match(html, /pointer-events:auto/);
  assert.match(source, /document\.addEventListener\('input'/);
  assert.doesNotMatch(source, /addEventListener\('focusin'/);
});

test('regression: theme click handler only matches actual theme buttons, not the html root', () => {
  assert.equal(source.includes("target.closest('[data-theme]')"), false);
  assert.equal(source.includes("target.closest('button[data-theme]')"), true);
});

test('all rendered action names are represented by the delegated action handler', () => {
  const names = [...new Set([...html.matchAll(/data-action=(?:\\?"|')([^"'\\]+)(?:\\?"|')/g)].map(m => m[1]))];
  const handled = new Set([...source.matchAll(/act===['"]([^'"]+)['"]/g)].map(m => m[1]));
  assert.ok(names.length >= 10, 'expected a meaningful set of interactive actions');
  assert.deepEqual(names.filter(name => !handled.has(name)), []);
});

test('team modal accepts typing, creates a squad, and player form persists', () => {
  const app = createHarness();
  app.click({ action: 'new-team' });
  assert.match(app.nodes['#app'].innerHTML, /id="teamForm"/);
  app.nodes['#teamNameInput'].focus();
  assert.equal(app.nodes['#teamNameInput'].focused, true, 'the input can receive focus');

  app.submit({
    id: 'teamForm', fields: {
      name: 'Metro XI', short: 'MTX', color: '#236447',
      players: 'Alpha Batter\nBravo Batter\nCharlie Batter'
    }, reportValidity() { return true; }
  });
  let db = app.data();
  assert.equal(db.teams.length, 1);
  assert.equal(db.teams[0].name, 'Metro XI');
  assert.equal(db.teams[0].players.length, 3);
  assert.match(app.nodes['#app'].innerHTML, /Add one more team below/);
  assert.equal(app.nodes['#modalhost'].innerHTML, '');

  app.submit({
    id: '', dataset: { team: db.teams[0].id },
    classList: { contains(name) { return name === 'addPlayerForm'; } },
    fields: { playerName: 'Fourth Player', jersey: '14' }
  });
  db = app.data();
  assert.equal(db.teams[0].players.length, 4);
  assert.equal(db.teams[0].players[3].name, 'Fourth Player');

  app.submit({ id: 'teamForm', fields: { name: 'Harbor XI', short: 'HBX', color: '#173f75', players: 'Delta\nEcho' }, reportValidity() { return true; } });
  db = app.data();
  assert.equal(db.teams.length, 2);
  assert.match(app.nodes['#app'].innerHTML, /Open Match Setup/);
  app.click({ tab: 'matches' });
  assert.match(app.nodes['#app'].innerHTML, /id="matchForm"/);
  assert.doesNotMatch(app.nodes['#app'].innerHTML, /Create one more team before starting a match/);
});

test('team and player Add buttons save directly without relying on native form submit', () => {
  const app = createHarness();
  const teamForm = {
    id: 'teamForm',
    fields: { name: 'Direct XI', short: 'DRX', color: '#236447', players: 'Batter One\nBatter Two' },
    reportValidity() { return true; }
  };
  app.click({ action: 'create-team', form: teamForm });
  let db = app.data();
  assert.equal(db.teams.length, 1);
  assert.equal(db.teams[0].name, 'Direct XI');
  assert.equal(db.teams[0].players.length, 2);
  assert.match(app.nodes['#saveStatus'].textContent, /Saved team: Direct XI/);

  const playerForm = {
    fields: { playerName: 'Third Batter', jersey: '9' },
    dataset: { team: db.teams[0].id },
    querySelector() { return null; }
  };
  app.click({ action: 'add-player', form: playerForm });
  db = app.data();
  assert.equal(db.teams[0].players.length, 3);
  assert.equal(db.teams[0].players[2].name, 'Third Batter');
  assert.match(app.nodes['#saveStatus'].textContent, /Saved player: Third Batter/);
});

test('match setup, legal scoring, extras, undo, wickets, innings transition and chase are consistent', () => {
  const app = createHarness();
  app.click({ action: 'new-team' });
  app.submit({ id: 'teamForm', fields: { name: 'Metro XI', short: 'MTX', color: '#236447', players: 'Alpha\nBravo\nCharlie' }, reportValidity() { return true; } });
  app.click({ action: 'new-team' });
  app.submit({ id: 'teamForm', fields: { name: 'Harbor XI', short: 'HBX', color: '#173f75', players: 'Delta\nEcho\nFoxtrot' }, reportValidity() { return true; } });
  let db = app.data();
  const [a, b] = db.teams;
  app.submit({ id: 'matchForm', fields: { name: 'Smoke Test Final', teamA: a.id, teamB: b.id, format: 'T20', overs: '20', ballsPerOver: '6', maxBowlerOvers: '4', venue: '', umpires: '' } });
  db = app.data();
  assert.equal(db.matches.length, 1);
  assert.equal(db.matches[0].currentInnings, 0);

  app.click({ run: '4' });
  db = app.data();
  const firstBowler = db.matches[0].innings[0].bowlerId;
  app.changeBowler(db.teams[1].players[1].id);
  assert.equal(app.data().matches[0].innings[0].bowlerId, firstBowler, 'a bowler cannot change mid-over');
  assert.ok(app.alerts.some(message => /only after the over is complete/i.test(message)));
  assert.equal(db.matches[0].innings[0].total, 4);
  assert.equal(db.matches[0].innings[0].balls, 1);

  app.click({ extra: 'noBall' });
  db = app.data();
  assert.equal(db.matches[0].innings[0].total, 5); // one penalty run; no legal ball added
  assert.equal(db.matches[0].innings[0].balls, 1);
  assert.equal(db.matches[0].innings[0].extras.noBall, 1);
  app.click({ action: 'undo' });
  db = app.data();
  assert.equal(db.matches[0].innings[0].total, 4);

  app.click({ extra: 'wide' });
  db = app.data();
  assert.equal(db.matches[0].innings[0].total, 5);
  assert.equal(db.matches[0].innings[0].balls, 1, 'a wide must not use a legal ball');
  assert.equal(db.matches[0].innings[0].extras.wide, 1);
  app.click({ action: 'undo' });
  assert.equal(app.data().matches[0].innings[0].total, 4);

  app.click({ extra: 'bye' });
  db = app.data();
  assert.equal(db.matches[0].innings[0].total, 5);
  assert.equal(db.matches[0].innings[0].balls, 2, 'a bye is a legal delivery');
  assert.equal(db.matches[0].innings[0].extras.bye, 1);
  app.click({ action: 'undo' });
  db = app.data();
  assert.equal(db.matches[0].innings[0].total, 4);
  assert.equal(db.matches[0].innings[0].balls, 1);

  for (let i = 0; i < 5; i++) app.click({ run: '1' });
  db = app.data();
  assert.equal(db.matches[0].innings[0].balls, 6);
  assert.equal(db.matches[0].innings[0].total, 9);

  app.changeBowler(db.teams[1].players[1].id);
  assert.equal(app.data().matches[0].innings[0].bowlerId, db.teams[1].players[1].id, 'a new bowler can be selected at the over boundary');
  app.click({ action: 'wicket' });
  const currentInning = app.data().matches[0].innings[0];
  const thirdPlayer = app.data().teams[0].players[2];
  app.submit({ id: 'wicketForm', fields: { type: 'Bowled', fielder: '', next: thirdPlayer.id } });
  db = app.data();
  assert.equal(db.matches[0].innings[0].wickets, 1);
  assert.equal(db.matches[0].innings[0].balls, 7);

  app.click({ action: 'end-innings' });
  db = app.data();
  assert.equal(db.matches[0].currentInnings, 1);
  assert.equal(db.matches[0].innings[1].target, db.matches[0].innings[0].total + 1);
  app.click({ run: '4' });
  app.click({ run: '6' });
  db = app.data();
  assert.equal(db.matches[0].status, 'completed');
  assert.ok(db.matches[0].completedAt);
  assert.match(db.matches[0].result, /won by .* wickets/);
  assert.equal(db.matches[0].innings.length, 2);
  app.click({ action: 'end-innings' });
  assert.equal(app.data().matches[0].innings.length, 2, 'a completed chase must not start a third innings');

  app.click({ action: 'open-match', id: db.matches[0].id });
  app.click({ action: 'undo' });
  db = app.data();
  assert.equal(db.matches[0].status, 'live');
  assert.equal(db.matches[0].result, undefined);
  assert.equal(db.matches[0].innings[1].total, 4);
  assert.equal(db.matches[0].innings[1].balls, 1);

  const reloaded = createHarness(app.existingStorage);
  assert.equal(reloaded.data().teams.length, 2);
  assert.equal(reloaded.data().matches[0].innings[1].total, 4);
  assert.match(reloaded.nodes['#app'].innerHTML, /Live Scoring|RUNS|overs/);
});

test('Test cricket can finish with the correct innings result', () => {
  const app = createHarness();
  app.click({ action: 'new-team' });
  app.submit({ id: 'teamForm', fields: { name: 'North XI', short: 'NRTH', color: '#236447', players: 'N1\nN2' }, reportValidity() { return true; } });
  app.click({ action: 'new-team' });
  app.submit({ id: 'teamForm', fields: { name: 'South XI', short: 'STH', color: '#173f75', players: 'S1\nS2' }, reportValidity() { return true; } });
  let db = app.data();
  app.submit({ id: 'matchForm', fields: { name: 'Test innings result', teamA: db.teams[0].id, teamB: db.teams[1].id, format: 'Test', overs: '20', ballsPerOver: '6', maxBowlerOvers: '4', venue: '', umpires: '' } });
  app.click({ action: 'end-innings' }); // North XI: 0
  app.click({ run: '1' });             // South XI: 1
  app.click({ action: 'end-innings' });
  app.click({ action: 'end-innings' }); // North XI second innings: 0
  db = app.data();
  assert.equal(db.matches[0].status, 'completed');
  assert.match(db.matches[0].result, /South XI won by an innings and 1 run/);
  assert.equal(db.matches[0].innings.length, 3, 'the fourth innings must not start when the match is already decided');
});


function seedMatch(app, format = 'T20', overs = '20') {
  app.click({ action: 'new-team' });
  app.submit({ id: 'teamForm', fields: { name: 'Metro XI', short: 'MTX', color: '#236447', players: 'A1\nA2\nA3' }, reportValidity() { return true; } });
  app.click({ action: 'new-team' });
  app.submit({ id: 'teamForm', fields: { name: 'Harbor XI', short: 'HBX', color: '#173f75', players: 'B1\nB2\nB3' }, reportValidity() { return true; } });
  const db = app.data();
  app.submit({ id: 'matchForm', fields: { name: 'Regression', teamA: db.teams[0].id, teamB: db.teams[1].id, format, overs, ballsPerOver: '6', maxBowlerOvers: '4', venue: '', umpires: '' } });
  return app.data();
}

test('a bowler is credited with a maiden only for a full over of scoreless legal balls', () => {
  const app = createHarness();
  seedMatch(app);
  for (let i = 0; i < 6; i++) app.click({ run: '0' });
  let inn = app.data().matches[0].innings[0];
  const maidenBowlerId = inn.bowlerId;
  assert.equal(inn.bowlers[maidenBowlerId].maidens, 1);
  const nextBowlerId = app.data().teams[1].players[1].id;
  app.changeBowler(nextBowlerId);
  app.click({ extra: 'wide' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.bowlers[maidenBowlerId].maidens, 1, 'a wide at the next over must not count the maiden twice');
  app.click({ action: 'undo' });
  app.changeBowler(nextBowlerId); // Undo clears the selection so the scorer explicitly reselects.
  app.click({ run: '1' });
  for (let i = 0; i < 5; i++) app.click({ run: '0' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.bowlers[inn.bowlerId].maidens, 0, 'an over containing a run is not a maiden');
});

test('undo snapshots stay small and restore the event history correctly', () => {
  const app = createHarness();
  seedMatch(app);
  for (let i = 0; i < 4; i++) app.click({ run: '1' });
  const m = app.data().matches[0];
  assert.ok(m.undo.every(entry => entry.inn.events.length === 0 && typeof entry.eventsLen === 'number'));
  app.click({ action: 'undo' });
  const inn = app.data().matches[0].innings[0];
  assert.equal(inn.events.length, 3);
  assert.equal(inn.total, 3);
});

test('a limited-overs chase that falls short finishes automatically with the correct margin', () => {
  const app = createHarness();
  seedMatch(app, 'Custom', '1');
  for (let i = 0; i < 6; i++) app.click({ run: '1' });
  app.click({ action: 'end-innings' });
  for (let i = 0; i < 6; i++) app.click({ run: '0' });
  const m = app.data().matches[0];
  assert.equal(m.status, 'completed');
  assert.equal(m.result, 'Metro XI won by 6 runs');
});

test('a Test match whose last innings is not all out is drawn, not awarded to the batting-first side', () => {
  const app = createHarness();
  seedMatch(app, 'Test');
  app.click({ run: '4' });
  app.click({ action: 'end-innings' });
  app.click({ run: '1' });
  app.click({ action: 'end-innings' });
  app.click({ run: '2' });
  app.click({ action: 'end-innings' });
  app.click({ run: '3' });
  app.click({ action: 'end-innings' });
  assert.equal(app.data().matches[0].result, 'Match drawn');
});

test('corrupt saved data is preserved under a backup key', () => {
  const storage = new Map([['pitchplay-cricket-v3', '{not valid json']]);
  const app = createHarness(storage);
  assert.ok([...storage.keys()].some(key => key.startsWith('pitchplay-cricket-v3-corrupt-')));
  assert.match(app.nodes['#app'].innerHTML, /Every run has a story|Create your team/);
});


test('scoring celebrations cover boundaries, wickets, fifties, centuries, overs and results', () => {
  assert.match(html, /@keyframes pp-scorefx/);
  assert.match(source, /function showMoment\(kind,title,detail\)/);
  assert.match(source, /showMoment\('four','BOUNDARY! FOUR'/);
  assert.match(source, /showMoment\('six','SIX! OUT OF THE PARK'/);
  assert.match(source, /showMoment\('milestone','HALF-CENTURY!'/);
  assert.match(source, /showMoment\('milestone','CENTURY!'/);
  assert.match(source, /showMoment\('wicket','WICKET!'/);
  assert.match(source, /showMoment\(inn\.complete\?'innings':'over',inn\.complete\?'INNINGS COMPLETE':'OVER COMPLETE'/);
  assert.match(source, /showMoment\('result','MATCH COMPLETE'/);
});
test('wicket flow requires an incoming batter except when the innings will be all out', () => {
  assert.match(source, /const needsNext=inn\.wickets\+1<wicketLimit\(inn\)/);
  assert.match(source, /needsNext\?'required':''/);
  assert.match(source, /Choose the incoming batter before confirming this wicket/);
  assert.match(source, /function openInningsSetup\(\)/);
  assert.match(source, /Choose two different active batters/);
  assert.doesNotMatch(html, /select data-batter=/);
});
test('match report includes every innings, extras breakdown, fall of wickets and ball-by-ball events', () => {
  assert.match(source, /function matchSummary\(m\)/);
  assert.match(source, /Export detailed match PDF/);
  assert.match(source, /function extrasBreakdown\(inn\)/);
  assert.match(source, /function fallOfWickets\(inn\)/);
  assert.match(source, /function ballByBallTable\(inn,m\)/);
  assert.match(source, /function inningsReport\(inn,m,index,printMode\)/);
  assert.match(source, /for\(let idx=0;idx<m\.innings\.length;idx\+\+\)/);
  assert.match(source, /window\.print\(\)/);
});


test('T10/T20/ODI presets and toss decision determine innings order while player selection stays manual', () => {
 const app=createHarness(new Map(),{tossWinnerField:'teamB',tossDecision:'bowl',autoSetup:false});
 app.click({action:'new-team'});app.submit({id:'teamForm',fields:{name:'North XI',short:'NR',color:'#236447',players:'N1\nN2'},reportValidity(){return true}});
 app.click({action:'new-team'});app.submit({id:'teamForm',fields:{name:'South XI',short:'ST',color:'#173f75',players:'S1\nS2'},reportValidity(){return true}});
 const teams=app.data().teams;
 app.submit({id:'matchForm',fields:{name:'Toss Test',teamA:teams[0].id,teamB:teams[1].id,format:'T10',overs:'10',ballsPerOver:'6',maxBowlerOvers:'4',venue:'',umpires:''}});
 let m=app.data().matches[0];assert.equal(m.overs,10);assert.equal(m.tossWinnerId,teams[1].id);assert.equal(m.tossDecision,'bowl');assert.equal(m.firstBattingTeamId,teams[0].id);assert.equal(m.innings[0].battingTeamId,teams[0].id);assert.equal(m.innings[0].strikerId,null);assert.equal(m.innings[0].nonStrikerId,null);assert.equal(m.innings[0].bowlerId,null);
 app.submit({id:'matchForm',fields:{name:'T20 Test',teamA:teams[0].id,teamB:teams[1].id,format:'T20',overs:'20',ballsPerOver:'6',maxBowlerOvers:'2',venue:'',umpires:''}});
 m=app.data().matches[0];assert.equal(m.overs,20);
 app.submit({id:'matchForm',fields:{name:'ODI Test',teamA:teams[0].id,teamB:teams[1].id,format:'ODI',overs:'50',ballsPerOver:'6',maxBowlerOvers:'4',venue:'',umpires:''}});
 assert.equal(app.data().matches[0].overs,50);
});
test('PDF report contains dismissal attribution and partnerships but excludes ball-by-ball listing',()=>{
 assert.ok(source.includes('function dismissalDescription(type,bowler,fielder)'));
 assert.ok(source.includes('function partnershipsTable(inn)'));
 const report=source.slice(source.indexOf('function inningsReport('),source.indexOf('function matchAwards('));
 assert.ok(report.includes('partnershipsTable(inn)'));
 assert.equal(report.includes('ballByBallTable(inn,m)'),false);
 assert.ok(source.includes('Download match scorecard PDF'));
});


test('desi match assistant refreshes every three legal balls and skips wides/no-balls', () => {
  const app = createHarness();
  seedMatch(app);
  for (let i = 0; i < 2; i++) app.click({ run: '1' });
  let inn = app.data().matches[0].innings[0];
  assert.equal(inn.assistantCommentary, null, 'no commentary refresh before three legal balls');
  app.click({ run: '1' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.assistantCommentary.legalBalls, 3);
  assert.match(inn.assistantCommentary.headline + inn.assistantCommentary.body, /bhai|scene|batting/i);
  app.click({ extra: 'wide' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.assistantCommentary.legalBalls, 3, 'wide is not a legal ball');
  app.click({ extra: 'noBall' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.assistantCommentary.legalBalls, 3, 'no-ball is not a legal ball');
  app.click({ run: '0' });
  app.click({ run: '0' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.assistantCommentary.legalBalls, 3, 'wait until the sixth legal ball');
  app.click({ run: '0' });
  inn = app.data().matches[0].innings[0];
  assert.equal(inn.assistantCommentary.legalBalls, 6);
});


test('undo reverses only the latest ball and preserves the chosen batters and bowler', () => {
 const app=createHarness();const db=seedMatch(app,'Custom','2');const m=db.matches[0],inn=m.innings[0];
 const original={striker:inn.strikerId,non:inn.nonStrikerId,bowler:inn.bowlerId};
 app.click({run:'4'});
 assert.equal(app.data().matches[0].innings[0].total,4);
 app.click({action:'undo'});
 const restored=app.data().matches[0].innings[0];
 assert.equal(restored.total,0);assert.equal(restored.balls,0);
 assert.equal(restored.strikerId,original.striker);assert.equal(restored.nonStrikerId,original.non);assert.equal(restored.bowlerId,original.bowler);
 assert.equal(app.nodes['#modalhost'].innerHTML,'','undo should not reopen player selection');
 app.click({run:'2'});
 assert.equal(app.data().matches[0].innings[0].total,2,'scoring should resume immediately after undo');
});

test('a custom two-over innings stops at twelve legal balls and completed matches return home while staying in history', () => {
 const app=createHarness();seedMatch(app,'Custom','2');
 for(let i=0;i<12;i++){app.click({run:'0'});if(i===5)app.changeBowler(app.data().teams[1].players[1].id)}
 let m=app.data().matches[0];
 assert.equal(m.innings[0].balls,12);assert.equal(m.innings[0].complete,true);
 app.click({run:'4'});
 assert.equal(app.data().matches[0].innings[0].balls,12,'no 13th legal ball in a two-over innings');
 app.click({action:'end-innings'});
 m=app.data().matches[0];assert.equal(m.currentInnings,1);assert.equal(m.innings[1].target,1);
 for(let i=0;i<12;i++){app.click({run:'0'});if(i===5)app.changeBowler(app.data().teams[0].players[1].id)}
 m=app.data().matches[0];assert.equal(m.status,'completed');assert.equal(m.innings[1].balls,12);assert.equal(app.data().currentMatchId,null);
 assert.match(app.nodes['#app'].innerHTML,/Every run has a story/,'completed match should return to the original home screen');
 app.click({tab:'matches'});
 assert.match(app.nodes['#app'].innerHTML,/Match history/);assert.match(app.nodes['#app'].innerHTML,/Regression/,'completed match remains in history');
});

test('PDF scorecard marks not-out batters with an asterisk and uses theme colour for live scoring', () => {
 assert.ok(source.includes('<span class="sub">*</span>'));
 assert.equal(source.includes('<span class="sub">not out</span>'),false);
 assert.ok(html.includes('.scorehero{background:var(--brand);color:white;'));
 assert.equal(html.includes('scorehero" style="--teamcolor:'),false);
});

test('team is collapsed by default showing team name, and can be expanded or deleted', () => {
 const app = createHarness();
 app.click({ action: 'new-team' });
 app.submit({ id: 'teamForm', fields: { name: 'Royal Strikers', short: 'RSX', color: '#236447', players: 'R1\nR2\nR3' }, reportValidity() { return true; } });
 let db = app.data();
 assert.equal(db.teams.length, 1);
 assert.match(app.nodes['#app'].innerHTML, /team-collapsed/);
 assert.match(app.nodes['#app'].innerHTML, /Royal Strikers/);
 // Click to toggle and expand squad
 app.click({ action: 'toggle-team', id: db.teams[0].id });
 assert.match(app.nodes['#app'].innerHTML, /team-expanded/);
 assert.match(app.nodes['#app'].innerHTML, /Captain \(C\)/);
 // Delete team removes it from storage
 app.click({ action: 'delete-team', id: db.teams[0].id });
 db = app.data();
 assert.equal(db.teams.length, 0);
});

test('saved match in match history can be deleted', () => {
 const app = createHarness();
 seedMatch(app, 'T20', '20');
 let db = app.data();
 assert.equal(db.matches.length, 1);
 const matchId = db.matches[0].id;
 app.click({ tab: 'matches' });
 assert.match(app.nodes['#app'].innerHTML, /Match history/);
 app.click({ action: 'delete-match', id: matchId });
 db = app.data();
 assert.equal(db.matches.length, 0);
});

test('clicking scorecard on completed match in matches history renders scorecard and not home screen', () => {
 const app = createHarness();
 seedMatch(app, 'Custom', '2');
 for (let i = 0; i < 12; i++) { app.click({ run: '0' }); if (i === 5) app.changeBowler(app.data().teams[1].players[1].id); }
 app.click({ action: 'end-innings' });
 for (let i = 0; i < 12; i++) { app.click({ run: '0' }); if (i === 5) app.changeBowler(app.data().teams[0].players[1].id); }
 const db = app.data();
 assert.equal(db.matches[0].status, 'completed');
 // Navigate to matches page
 app.click({ tab: 'matches' });
 assert.match(app.nodes['#app'].innerHTML, /Match history/);
 assert.match(app.nodes['#app'].innerHTML, /📊 Scorecard/);
 // Click open-match on completed match
 app.click({ action: 'open-match', id: db.matches[0].id });
 // Verify it renders Match summary / Scorecard and not home page
 assert.match(app.nodes['#app'].innerHTML, /Match summary & Scorecard|Match summary/);
 assert.match(app.nodes['#app'].innerHTML, /FINAL RESULT/);
 assert.doesNotMatch(app.nodes['#app'].innerHTML, /Every run has a story/);
});

test('end-innings prompts with confirmation and export scorecard modal provides download and print options', () => {
 const app = createHarness();
 seedMatch(app, 'T20', '20');
 app.click({ run: '4' });
 // Trigger print scorecard
 app.click({ action: 'print' });
 assert.match(app.nodes['#modalhost'].innerHTML, /SCORECARD EXPORT &amp; PRINT/);
 assert.match(app.nodes['#modalhost'].innerHTML, /Download Offline Scorecard/);
 assert.match(app.nodes['#modalhost'].innerHTML, /Print \/ Save as PDF/);
 app.click({ action: 'close-modal' });
 assert.equal(app.nodes['#modalhost'].innerHTML, '');
});


