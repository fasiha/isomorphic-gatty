import {execSync} from 'child_process';
import {mkdirSync, promises} from 'fs';
import tape from 'tape';

import {Gatty, writer} from './index';

const git = require('isomorphic-git');
const fs = require('fs');
const rimraf = require('rimraf');

git.plugins.set('fs', fs);

function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
const uids = events.map(slug);

const REMOTEDIR = 'github';
const DIR = 'whee';

tape('intro', async function intro(t) {
  // delete old git dirs
  rimraf.sync(DIR);
  rimraf.sync(REMOTEDIR);
  rimraf.sync(REMOTEDIR + '.git');

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

  mkdirSync(REMOTEDIR);
  git.init({dir: REMOTEDIR});
  await promises.writeFile(`${REMOTEDIR}/README.md`, 'Welcome!');
  await git.add({dir: REMOTEDIR, filepath: 'README.md'});
  await git.commit({dir: REMOTEDIR, message: 'Initial', author: {name: 'Gatty', email: 'gatty@localhost'}});

  execSync(`git clone --bare ${REMOTEDIR} ${REMOTEDIR}.git`);
  execSync(`node_modules/.bin/git-http-mock-server start`);

  await git.clone({dir: gatty.dir, url: `http://localhost:8174/${REMOTEDIR}.git`});

  await git.pull({dir: gatty.dir});

  // nothing to write, empty store
  {
    const {newEvents, newSharedUid} = await writer(gatty, '', [], []);
    t.equal(newSharedUid, '');
    t.deepEqual(newEvents, [], 'empty store: no new events');
    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    t.equal(eventFiles.size, 0, 'no files in event directory');
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));
    t.equal(uniqueFiles.size, 0, 'no files in unique directory');

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 1, 'only 1 commit, from remote');
  }

  // // Write new events to empty store
  {
    const {newEvents, newSharedUid} = await writer(gatty, '', uids, events);
    t.equal(newSharedUid, uids[uids.length - 1], 'shared last event');
    t.deepEqual(newEvents, [], 'no new events');

    const eventFiles = new Set(await promises.readdir(DIR + '/_events'));
    const uniqueFiles = new Set(await promises.readdir(DIR + '/_uniques'));

    t.equal(eventFiles.size, 1, 'only one event file on disk');
    t.ok(eventFiles.has('1'), 'expected event file found on dist');
    t.equal(uniqueFiles.size, uids.length, 'expected # of uniques on disk');
    uids.forEach(u => t.ok(uniqueFiles.has(`${u}`), 'unique file created'));

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 2, 'now 2 commits');
  }

  // No new events, just checking for remotes
  {
    const {newEvents, newSharedUid} = await writer(gatty, uids[uids.length - 1], uids, events);
    // console.log({newEvents, newSharedUid});
    t.deepEqual(newEvents, [], 'no new events from remote');
    t.equal(newSharedUid, uids[uids.length - 1], 'idempotent even though we "added" them');

    const commits = await git.log({dir: DIR, depth: 5000});
    t.equal(commits.length, 2, 'still 2 commits');
  }

  execSync(`node_modules/.bin/git-http-mock-server stop`);
  rimraf.sync(DIR);
  rimraf.sync(REMOTEDIR);
  rimraf.sync(REMOTEDIR + '.git');

  t.end();
})

function sleep(ms: number) { return new Promise(resolve => {setTimeout(resolve, ms)}); }