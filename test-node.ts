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

tape('intro', async function intro(t) {
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

  // nothing to write, empty store
  {
    const {newEvents, filesTouched} = await writeNewEvents(gatty, '', [], []);
    t.deepEqual(newEvents, [], 'empty store: no new events');
    t.deepEqual(Array.from(filesTouched), [], 'no events saved: no files touched');
    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    t.equal(eventFiles.size, 0, 'no files in event directory');
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));
    t.equal(uniqueFiles.size, 0, 'no files in unique directory');
  }

  // Write new events to empty store
  {
    const {newEvents, filesTouched} = await writeNewEvents(gatty, '', uids, events);
    t.deepEqual(newEvents, [], 'no new events');
    t.ok(filesTouched.has('_events/1'), 'first event file initialized');
    uids.forEach(u => t.ok(filesTouched.has(`_uniques/${u}`), 'unique file created'));

    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));

    t.equal(eventFiles.size, 1, 'only one event file on disk');
    t.ok(eventFiles.has('1'), 'expected event file found on dist');
    t.equal(uniqueFiles.size, uids.length, 'expected # of uniques on disk');
    uids.forEach(u => t.ok(uniqueFiles.has(`${u}`), 'unique file created'));
  }

  // No new events, just checking for remotes
  {
    const {newEvents, filesTouched} = await writeNewEvents(gatty, uids[uids.length - 1], uids, events);
    console.log({newEvents, filesTouched});
  }

  rimraf.sync(DIR);
  t.end();
})
