'use strict';

var readline=require('node:readline');

function banner(shell){
  var state=shell.client?'Connected to '+shell.client.dialect:'Not connected';
  return [
    'NuBlox Shell v0.1.0',
    state,
    'Type \\help for commands; terminate multi-line SQL with a semicolon.'
  ].join('\n');
}

async function run(shell,io){
  io=io||{};
  var input=io.stdin||process.stdin;
  var stdout=io.stdout||process.stdout;
  var stderr=io.stderr||process.stderr;
  var rl=readline.createInterface({input:input,crlfDelay:Infinity,terminal:!!(input.isTTY&&stdout.isTTY)});
  var buffer='';

  stdout.write(banner(shell)+'\n');
  if(input.isTTY)stdout.write(shell.prompt());

  try{
    for await (var raw of rl){
      var line=String(raw);
      var trimmed=line.trim();
      var isCommand=!buffer&&trimmed.charAt(0)==='\\';

      if(isCommand){
        try{
          var commandResult=await shell.executeLine(trimmed);
          if(commandResult.kind==='quit')break;
          var commandText=shell.render(commandResult);
          if(commandText)stdout.write(commandText+'\n');
        }catch(error){
          stderr.write((error&&error.message?error.message:String(error))+'\n');
        }
      }else{
        buffer+=(buffer?'\n':'')+line;
        if(trimmed.endsWith(';')){
          try{
            var sqlResult=await shell.executeLine(buffer);
            var sqlText=shell.render(sqlResult);
            if(sqlText)stdout.write(sqlText+'\n');
          }catch(error){
            stderr.write((error&&error.message?error.message:String(error))+'\n');
          }
          buffer='';
        }
      }
      if(input.isTTY)stdout.write(buffer?'...> ':shell.prompt());
    }
  }finally{
    rl.close();
  }
  return 0;
}

exports.banner=banner;
exports.run=run;
