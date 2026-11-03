import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const server=createServer((req,res)=>{if(req.url==='/bad')res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({environment:process.env.ENVIRONMENT,revision:process.env.REVISION,host:req.headers.host}));});
server.on('upgrade',(req,socket)=>{
 const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);socket.on('error',()=>{});socket.on('end',()=>socket.end());
});
server.listen(8080,'0.0.0.0');
