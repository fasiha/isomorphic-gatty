import {atomicAppend, setup} from './index';

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function test(url: string, username: string, token: string, corsProxy?: string) {
  let gatty = await setup({username, token, corsProxy}, url);
  for (let i = 0; i < 5; i++) {
    const d = new Date().toISOString();
    console.log(`### ${d} (${i})`);
    await atomicAppend(gatty, 'foo', 'gatty Was here! ' + i + ' on ' + d + '\n', d, 'gatty', 'gatty');
    await sleep(1000);
  }
  console.log('done');
}
