import {pbkdf2Sync} from 'crypto';
import {promises} from 'fs';
import tape from 'tape';

import {Gatty, writeNewEvents} from './index';

const git = require('isomorphic-git');
const fs = require('fs');
const rimraf = require('rimraf');

git.plugins.set('fs', fs);

function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
const uids = events.map(slug);

const DIR = 'whee';

tape('intro', async t => {
  // delete old git dir
  rimraf.sync(DIR);

  const gatty: Gatty = {
    pfs: promises,
    dir: DIR,
    corsProxy: '',
    branch: '',
    depth: -1,
    since: new Date(),
    username: '',
    password: '',
    token: '',
    eventFileSizeLimit: 900
  };

  const {newEvents, filesTouched} = await writeNewEvents(gatty, '', uids, events);
  t.deepEqual(newEvents, []);
  t.deepEqual(Array.from(filesTouched).sort(), ['_events/1']);

  t.deepEqual(await promises.readdir(`${DIR}/_events/`), ['1']);
  t.deepEqual((await promises.readdir(`${DIR}/_uniques/`)).sort(), ['hello', 'hi-there', 'how-are-you'].sort());

  rimraf.sync(DIR);
  t.end();
})
