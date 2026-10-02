// Every new visit starts with an empty nickname; reconnections within the page keep identity.
(() => {
  for(const game of ['mafia','telepathy']) for(const key of ['Name','PlayerId','RoomCode']) localStorage.removeItem(game+key);
  const blank = () => { const input=document.getElementById('name'); if(input){input.value='';input.autocomplete='off';} };
  blank(); window.addEventListener('pageshow', blank);
  const code=new URLSearchParams(location.search).get('room');
  if(code){
    const tab=document.getElementById('joinTab')||document.getElementById('tabJoin');
    if(tab)tab.click();
    const input=document.getElementById('code');if(input)input.value=code.toUpperCase();
  }
  socket.on('session:reset',({code})=>{
    socket.disconnect();
    location.replace(location.pathname+'?room='+encodeURIComponent(code));
  });
})();
