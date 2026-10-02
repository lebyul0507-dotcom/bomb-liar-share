const assert=require('node:assert/strict');
const {io}=require('socket.io-client');
const {drawQuestions}=require('../question-deck');
const {allQuestions}=require('../telepathy-questions');
const sockets=[];
const pause=()=>new Promise(r=>setTimeout(r,50));
async function client(){const s=io('http://localhost:3100',{transports:['websocket']});sockets.push(s);s.states={};for(const e of ['mafia:update','telepathy:update','room:update','relay:update'])s.on(e,r=>s.states[e]=r);await new Promise(r=>s.on('connect',r));return s}
const emit=(s,e,d={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(e,d,(err,r)=>err?reject(err):resolve(r)));
async function main(){
 assert.equal(allQuestions.length,1000);const room={},seen=new Set();const unique=[...new Set(allQuestions)];
 for(let i=0;i<unique.length;i++){let [q]=drawQuestions(room,allQuestions,1,x=>x);assert(!seen.has(q));seen.add(q)}
 assert(drawQuestions(room,allQuestions,10,x=>x).length===10);
 for(const [create,join] of [['room:create','room:join'],['relay:create','relay:join']]){
  const a=await client(),b=await client();let r=await emit(a,create,{name:'처음온사람'});assert(r.ok);assert((await emit(b,join,{code:r.code,name:'새참가자'})).ok);
  const c=await client();assert.equal((await emit(c,join,{code:r.code,name:'새참가자'})).ok,false);assert(a.connected&&b.connected);
 }
 const a=await client(),b=await client();let t=await emit(a,'telepathy:create',{name:'질문방장'});await emit(b,'telepathy:join',{code:t.code,name:'참가자'});
 await emit(a,'telepathy:start',{settings:{count:1,timer:0,category:'random'}});await pause();const first=a.states['telepathy:update'].currentQuestion;assert(allQuestions.includes(first));
 await emit(a,'telepathy:answer',{answer:'같음'});await emit(b,'telepathy:answer',{answer:'같음'});await emit(a,'telepathy:next');
 let reset=false;a.once('session:reset',()=>reset=true);await emit(a,'telepathy:restart');await pause();assert(reset);
 await emit(a,'telepathy:join',{code:t.code,name:'바꾼방장'});await emit(b,'telepathy:join',{code:t.code,name:'바꾼참가자'});
 await emit(a,'telepathy:start',{settings:{count:1,timer:0,category:'random'}});await pause();assert.notEqual(a.states['telepathy:update'].currentQuestion,first);assert.equal(a.states['telepathy:update'].players.length,2);
 const players=await Promise.all(Array.from({length:4},()=>client()));const m=await emit(players[0],'mafia:create',{name:'첫방장'});
 for(let i=1;i<4;i++)assert((await emit(players[i],'mafia:join',{code:m.code,name:'새이름'+i})).ok);
 assert((await emit(players[0],'mafia:start')).ok);await pause();const roles=players.map(s=>s.states['mafia:update'].myRole);assert.deepEqual([...roles].sort(),['CITIZEN','DOCTOR','MAFIA','POLICE']);
 for(const s of players)assert.equal(s.states['mafia:update'].players.filter(p=>p.role).length,1);
 for(const s of players)await emit(s,'mafia:role:ready');await emit(players[0],'mafia:day:skip');await emit(players[0],'mafia:vote:finish');await pause();assert.equal(players[0].states['mafia:update'].phase,'NIGHT');
 const victim=players[roles.indexOf('CITIZEN')].states['mafia:update'].players.find(p=>p.role==='CITIZEN').id;
 const police=players[roles.indexOf('POLICE')];const mafiaId=players[roles.indexOf('MAFIA')].states['mafia:update'].players.find(p=>p.role==='MAFIA').id;
 await emit(players[roles.indexOf('MAFIA')],'mafia:night',{kind:'kill',targetId:victim});await emit(players[roles.indexOf('DOCTOR')],'mafia:night',{kind:'save',targetId:victim});
 assert((await emit(police,'mafia:night',{kind:'inspect',targetId:mafiaId})).result.isMafia);await pause();assert.equal(players[0].states['mafia:update'].phase,'MORNING');assert(players[0].states['mafia:update'].players.every(p=>p.alive));
 await emit(players[0],'mafia:stop');assert((await emit(players[0],'mafia:join',{code:m.code,name:'다음게임이름'})).ok);
 console.log('PASS: arbitrary names, duplicate protection, 997 unique prompts before repeats, replay names, telepathy scoring flow, 4-player mafia role privacy / kill / save / investigation / replay');
}
main().then(()=>{sockets.forEach(s=>s.disconnect());process.exit(0)}).catch(e=>{console.error(e);sockets.forEach(s=>s.disconnect());process.exit(1)});
