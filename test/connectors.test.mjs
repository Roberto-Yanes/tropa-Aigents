import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectorCatalog} from '../connectors.mjs';
test('catalog clearly distinguishes planned connectors from authorized accounts',()=>{
 assert.equal(new Set(connectorCatalog.map(x=>x.id)).size,connectorCatalog.length);
 for(const id of ['gmail','google-calendar','google-drive','outlook-mail','outlook-calendar','onedrive','mcp'])assert.ok(connectorCatalog.some(x=>x.id===id));
 assert.ok(connectorCatalog.every(x=>x.status==='not_implemented'));
});
