import { createServer } from 'node:http';
import { attachRelay } from './relay.js';

const port = Number(process.env.PORT || 3000);
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end('Lost Suppression multiplayer relay online\n');
});
attachRelay(server);
server.listen(port, '0.0.0.0', () => console.log(`Multiplayer relay listening on ${port}`));
