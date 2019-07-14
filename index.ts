const LightningFS = require('@isomorphic-git/lightning-fs');
const git = require('isomorphic-git');

const DEFAULT_DIR = '/gitdir';
const DEFAULT_PROXY = 'https://cors.isomorphic-git.org';

import {Stats, promises} from 'fs';
type PFS = typeof promises;

export type Gatty = {
  pfs: PFS,
  dir: string,
  corsProxy: string,
  branch: string|undefined,
  depth: number|undefined,
  since: Date|undefined,
  username: string|undefined,
  password: string|undefined,
  token: string|undefined,
  eventFileSizeLimit: number,
};

export async function setup({
  dir = DEFAULT_DIR,
  corsProxy = DEFAULT_PROXY,
  branch,
  depth,
  since,
  username,
  password,
  token,
  eventFileSizeLimit = 900
}: Partial<Gatty> = {},
                            url: string, fs?: any): Promise<Gatty> {
  if (!fs) {
    const fs = new LightningFS('fs', {wipe: true});
    git.plugins.set('fs', fs);
  }
  const pfs = fs.promises;

  await pfs.mkdir(dir);
  await git.clone({url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token});
  return {dir, corsProxy, pfs, branch, depth, since, username, password, token, eventFileSizeLimit};
}

export async function push({dir, username, password, token}: Gatty) {
  let pushres = await git.push({dir, username, password, token});
  return pushres.errors;
}

export async function ls({dir, pfs}: Gatty, filepath: string = ''): Promise<string[]> {
  return pfs.readdir(filepath ? `${dir}/${filepath}`.replace(/\/+$/, '') : dir);
}

export async function readFile({dir, pfs}: Gatty, filepath: string): Promise<string> {
  return pfs.readFile(`${dir}/${filepath}`, 'utf8');
}

export async function writeFileCommit({pfs, dir}: Gatty, filepath: string, contents: string, message: string,
                                      name: string = 'Me', email: string = 'mrtest@example.com'): Promise<string> {
  await pfs.writeFile(`${dir}/${filepath}`, contents, 'utf8');
  await git.add({dir, filepath});
  return git.commit({dir, message, author: {name, email}});
}

type PushResult = {
  ok: string[],
  errors?: string[],
};
/**
 * Returns NEXT pointer, i.e., pointer to the END of the appended string
 */
async function appendFile({pfs, dir}: Gatty, filepath: string, content: string): Promise<Pointer> {
  console.log('## going to write to ' + dir + '/' + filepath);
  let oldContents = '';
  const fullpath = `${dir}/${filepath}`;
  try {
    oldContents = await pfs.readFile(fullpath, 'utf8');
  } catch (e) {
    // `readFile` will throw if file not found. Moving along.
  }
  await pfs.writeFile(fullpath, oldContents + content, 'utf8');
  return makePointer(filepath, oldContents.length + content.length);
}

export async function atomicAppend(gatty: Gatty, filepath: string, content: string, message: string, name: string,
                                   email: string, maxRetries = 3) {
  const {pfs, dir, username, password, token} = gatty;
  for (let retry = 0; retry < maxRetries; retry++) {
    // pull remote (rewind if failed?)
    await git.pull({dir, singleBranch: true, fastForwardOnly: true, username, password, token});
    // write/append
    await appendFile(gatty, filepath, content);
    // add & commit
    await git.add({dir, filepath});
    await git.commit({dir, message, author: {name, email}});
    // push
    const pushed: PushResult = await git.push({dir, username, password, token});
    if (pushed.errors) {
      // if push failed, roll back commit and retry, up to some maximum
      const branch = await git.currentBranch({dir});
      await gitReset({pfs, git, dir, ref: 'HEAD~1', branch, hard: true});
    } else {
      return;
    }
  }
  throw new Error('failed to commit');
}

type GitResetArgs = {
  pfs: any,
  git: any,
  dir: string,
  ref: string,
  branch: string,
  hard?: boolean
};
// Thanks to jcubic: https://github.com/isomorphic-git/isomorphic-git/issues/729#issuecomment-489523944
async function gitReset({pfs, git, dir, ref, branch, hard = false}: GitResetArgs) {
  const re = /^HEAD~([0-9]+)$/;
  const m = ref.match(re);
  if (!m) { throw new Error(`Wrong ref ${ref}`) }
  const count = +m[1];
  const commits = await git.log({dir, depth: count + 1});
  if (commits.length < count + 1) { throw new Error('Not enough commits'); }
  const commit: string = commits[commits.length - 1].oid;
  await pfs.writeFile(`${dir}/.git/refs/heads/${branch}`, commit + '\n');
  if (!hard) { return }
  // clear the index (if any)
  await pfs.unlink(`${dir}/.git/index`);
  // checkout the branch into the working tree
  return git.checkout({dir, ref: branch});
}

async function fileExists({pfs, dir}: Gatty, filepath: string): Promise<boolean> {
  const fullpath = `${dir}/${filepath}`;
  try {
    const res = await pfs.stat(fullpath);
    return !res.isDirectory();
  } catch (e) { return false; }
}

const UNIQUES_DIR = '_uniques';
const EVENTS_DIR = '_events';
const POINTER_SEP = '-';
const BASE = 36;

function last<T>(arr: T[]): T|undefined { return arr[arr.length - 1]; }

type Pointer = {
  relativeFile: string,
  chars: number
};
function makePointer(relativeFile: string, chars: number): Pointer { return {relativeFile, chars}; }

async function lastPointer({pfs, dir}: Gatty): Promise<Pointer> {
  const lastFile = last(await pfs.readdir(`${dir}/${EVENTS_DIR}`));
  if (!lastFile) { return makePointer('', 0); }
  const filecontents = await pfs.readFile(`${dir}/${EVENTS_DIR}/${lastFile}`, 'utf8');
  // Cannot replace readFile (expensive) with stat because stat's size is true bytes while we need UTF-16 chars
  return makePointer(`${EVENTS_DIR}/${lastFile}`, filecontents.length);
}

/**
 * Returns output of `appendFile` on event, i.e., pointer to the END of the saved payload
 */
async function addEvent(gatty: Gatty, uid: string, payload: string, pointer: Partial<Pointer> = {}): Promise<Pointer> {
  if (!('relativeFile' in pointer && 'chars' in pointer && pointer.relativeFile)) {
    const {relativeFile, chars} = await lastPointer(gatty);
    pointer.relativeFile = relativeFile || `${EVENTS_DIR}/1`;
    pointer.chars = chars;
  }
  const {relativeFile, chars} = pointer as Pointer;

  const uniqueFile = `${UNIQUES_DIR}/${uid}`;
  if (await fileExists(gatty, uniqueFile)) { return makePointer(relativeFile, chars); }

  const {eventFileSizeLimit} = gatty;
  if (chars < eventFileSizeLimit) {
    // Unique file should contain pointer to BEGINNING of payload
    await appendFile(gatty, uniqueFile, `${relativeFile}${POINTER_SEP}${chars.toString(BASE)}`);
    return appendFile(gatty, relativeFile, payload);
  }

  const lastFilename = last(relativeFile.split('/')) || '1';
  const parsed = parseInt(lastFilename, BASE);
  if (isNaN(parsed)) { throw new Error('non-numeric filename'); }
  const newFile = EVENTS_DIR + '/' + (parsed + 1).toString(BASE);
  // Unique file should contain pointer to BEGINNING of payload
  await appendFile(gatty, uniqueFile, `${newFile}${POINTER_SEP}0`);
  return appendFile(gatty, newFile, payload);
}

/**
 * Pointer to BEGINNING of the unique ID's payload
 */
async function uniqueToPointer(gatty: Gatty, unique: string): Promise<Pointer> {
  if (!unique) { return makePointer('', 0) }
  const pointerStr = await readFile(gatty, `${UNIQUES_DIR}/${unique}`);
  const [file, offset] = pointerStr.split(POINTER_SEP);
  if (!file || !offset) { throw new Error('failed to parse unique ' + unique); }
  return makePointer(file, parseInt(offset, BASE));
}

async function pointerToPointer(gatty: Gatty, start: Pointer, end: Pointer): Promise<string> {
  if (!start.relativeFile || !end.relativeFile) { return ''; }
  // if all in a single file, slurp it, slice off either edge, and return
  if (start.relativeFile === end.relativeFile) {
    return (await readFile(gatty, start.relativeFile)).slice(start.chars, end.chars);
  }
  // if *multiple* files, slurp each of them in order. The first and last should be trimmed.
  const fileInts = [start, end].map(({relativeFile}) => parseInt(relativeFile.slice(EVENTS_DIR.length + 1), BASE));
  let contents = '';
  for (let i = fileInts[0]; i <= fileInts[1]; i++) {
    const all = await readFile(gatty, EVENTS_DIR + '/' + i.toString(BASE));
    if (i === fileInts[0]) {
      contents += all.slice(start.chars)
    } else if (i === fileInts[1]) {
      contents += all.slice(0, end.chars);
    } else {
      contents += all;
    }
  }
  return contents;
}

async function mkdirp({dir, pfs}: Gatty) {
  for (const path of [dir, `${dir}/${EVENTS_DIR}`, `${dir}/${UNIQUES_DIR}`]) {
    try {
      await pfs.mkdir(path);
    } catch {}
  }
}

export async function writeNewEvents(gatty: Gatty, lastSharedUid: string, uids: string[],
                                     events: string[]): Promise<{newEvents: string[], filesTouched: Set<string>}> {
  await mkdirp(gatty);
  const INIT_POINTER = makePointer(`${EVENTS_DIR}/1`, 0);

  if (lastSharedUid && !(await fileExists(gatty, `${UNIQUES_DIR}/${lastSharedUid}`))) {
    throw new Error('lastSharedUid is in fact not shared ' + lastSharedUid);
  }
  // Write to store the unsync'd events
  let pointer: Pointer = await lastPointer(gatty);
  const endPointer = makePointer(pointer.relativeFile, pointer.chars);
  const filesTouched: Set<string> = new Set(uids.map(u => `${UNIQUES_DIR}/${u}`));
  // duplicates might not need commiting but include them above pre-emptively
  {
    let i = 0;
    for (const e of events) {
      pointer = await addEvent(gatty, uids[i++], e, pointer);
      filesTouched.add(pointer.relativeFile);
    }
  }
  // get all events that others have pushed that we lack, from lastShareUid to endPointer
  const startPointer = lastSharedUid ? await uniqueToPointer(gatty, lastSharedUid) : INIT_POINTER;
  const rawContents = await pointerToPointer(gatty, startPointer, endPointer);
  const newEvents = rawContents ? rawContents.trim().split('\n') : [];
  return {newEvents: lastSharedUid ? newEvents.slice(1) : newEvents, filesTouched};
}

if (module === require.main) {
  let {promises} = require('fs');

  (async function() {
    const gatty: Gatty = {
      pfs: promises,
      dir: 'whee',
      corsProxy: '',
      branch: '',
      depth: -1,
      since: new Date(),
      username: '',
      password: '',
      token: '',
      eventFileSizeLimit: 900
    };

    function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
    const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
    const uids = events.map(slug);
    {
      console.log('## INITIAL WRITE ON EMPTY STORE');
      const {newEvents, filesTouched} = await writeNewEvents(gatty, '', uids, events);
      console.log('filesTouched', filesTouched);
      console.log('newEvents', newEvents)
    }

    {
      console.log('## CHECKING FOR NEW REMOTES');
      const {newEvents, filesTouched} = await writeNewEvents(gatty, last(uids) || '', uids, events);
      console.log('filesTouched', filesTouched);
      console.log('newEvents', newEvents)
    }

    {
      console.log('## APPENDING NEW EVENTS FROM BEFORE');
      let events2 = 'chillin,cruisin,flying'.split(',').map(s => s + '\n');
      let uids2 = events2.map(slug);
      const {newEvents, filesTouched} = await writeNewEvents(gatty, uids[uids.length - 1], uids2, events2);
      console.log('filesTouched', filesTouched);
      console.log('newEvents', newEvents)
    }

    {
      console.log('## NEW DEVICE THAT ONLY HAS PARTIAL STORE (first commit, hello etc.)');
      let events2 = 'ichi,ni,san'.split(',').map(s => s + '\n');
      let uids2 = events2.map(slug);
      const {newEvents, filesTouched} = await writeNewEvents(gatty, uids[uids.length - 1], uids2, events2);
      console.log('filesTouched', filesTouched);
      console.log('newEvents', newEvents)
    }

    {
      console.log('## FRESH DEVICE, with events to commit, nothing in store');
      let events2 = 'never,giv,up'.split(',').map(s => s + '\n');
      let uids2 = events2.map(slug);
      const {newEvents, filesTouched} = await writeNewEvents(gatty, '', uids2, events2);
      console.log('filesTouched', filesTouched);
      console.log('newEvents', newEvents)
    }

    console.log('done');
  })();
}
