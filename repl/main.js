'use strict';

const http = require('http').createServer();

const io = require('socket.io')(http);
const babel = require('babel-core');
const readline = require('readline');


let context = 'main';


const pretty = (msg) =>
  typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);


io.on('connection', (socket) => {
  socket.on('evalResult', (msg) => {
    if (msg.result) {
      console.log('= ' + pretty(msg.result));
    }
    if (msg.error) {
      console.log('! ' + msg.error);
    }
    rl.prompt();
  });

  socket.on('log', (msg) => {
    console.log('~ ' + pretty(msg));
    rl.prompt();
  });

  rl.prompt();
});

http.listen(5000, () => console.log('listening on *:5000'));


const transform = (code) => {
  code = "'use extensible';\n" + code;
  const filename = context + '.js';
  return babel.transform(code, {
    retainLines: true,
    compact: true,
    comments: false,
    filename,
    sourceFileName: filename,
    sourceMaps: false,
  }).code;
};


let multi = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('line', (line) => {
  if (line.startsWith(':context ')) {
    context = line.split(' ')[1];
    console.log('context is now \'' + context + '\'');
    rl.prompt();
    return;
  }

  if (line.startsWith(':multi')) {
    multi = '';
    return;
  }
  if (multi !== null) {
    if (line.startsWith(':end')) {
      line = multi;
      multi = null;
    } else {
      multi += '\n' + line;
      return;
    }
  }

  io.emit('evalIn', { contextName: context, code: transform(line) });
});


