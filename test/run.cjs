const {spawn}=require('node:child_process');
const server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3100'}});
server.stderr.pipe(process.stderr);
server.stdout.once('data',()=>{const test=spawn(process.execPath,['test/games.cjs'],{stdio:'inherit'});test.on('exit',code=>{server.kill();process.exit(code)})});
