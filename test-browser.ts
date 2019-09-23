import {inspect, setup, sync} from './index';

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function test(url: string, username: string, token: string) {
  let gatty = await setup({username, token, corsProxy: 'https://cors.isomorphic-git.org'}, url);
  let lastSharedUid = '';
  for (let i = 0; i < 1; i++) {
    // inspect(gatty);
    const d = new Date().toISOString();
    const text = `### ${d} (${i})`;
    const uid = text.replace(/[^0-9]+/g, ' ').trim().replace(/ /g, '_');
    const {newSharedUid, newEvents} = await sync(gatty, lastSharedUid, [uid], [{text}].map(x => JSON.stringify(x)), 1);
    console.log({lastSharedUid, text, newSharedUid, newEvents});
    lastSharedUid = newSharedUid;
    await sleep(1000);
  }
  // inspect(gatty);
  console.log('done');
}
