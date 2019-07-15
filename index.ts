const LightningFS = require('@isomorphic-git/lightning-fs');
import {default as gitts} from 'isomorphic-git';
const git: typeof gitts = require('isomorphic-git');

const DEFAULT_DIR = '/gitdir';
const DEFAULT_PROXY = 'https://cors.isomorphic-git.org';

import {promises} from 'fs';
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

  await git.clone({url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token});
  return {dir, corsProxy, pfs, branch, depth, since, username, password, token, eventFileSizeLimit};
}

async function readFile({dir, pfs}: Gatty, filepath: string): Promise<string> {
  return pfs.readFile(`${dir}/${filepath}`, 'utf8');
}

/**
 * Returns NEXT pointer, i.e., pointer to the END of the appended string
 */
async function appendFile({pfs, dir}: Gatty, filepath: string, content: string): Promise<Pointer> {
  // console.log('## going to write to ' + dir + '/' + filepath);
  let oldContents = '';
  const fullpath = `${dir}/${filepath}`;
  try {
    oldContents = await pfs.readFile(fullpath, 'utf8');
  } catch (e) {
    // `readFile` will throw if file not found. Moving along.
  }
  await pfs.writeFile(fullpath, oldContents + content, 'utf8');
  await git.add({dir, filepath})
  return makePointer(filepath, oldContents.length + content.length);
}

export type GitResetArgs = {
  pfs: PFS,
  git: typeof git,
  dir: string,
  ref: string,
  branch: string,
  hard?: boolean,
  cached?: boolean
};
// Thanks to jcubic: https://github.com/isomorphic-git/isomorphic-git/issues/729#issuecomment-489523944
export async function gitReset({pfs, git, dir, ref, branch, hard = false, cached = true}: GitResetArgs) {
  const re = /^HEAD~([0-9]+)$/;
  const m = ref.match(re);
  if (!m) { throw new Error(`Wrong ref ${ref}`) }
  const count = +m[1];
  const commits = await git.log({dir, depth: count + 1});
  if (commits.length < count + 1) { throw new Error('Not enough commits'); }
  const commit = commits[commits.length - 1].oid;

  // for non-cached mode, list files in staging area
  let before: string[] = [];
  if (!cached) { before = await git.listFiles({dir}); }

  await pfs.writeFile(`${dir}/.git/refs/heads/${branch}`, commit + '\n');
  if (!hard) { return; }
  // clear the index (if any)
  await pfs.unlink(`${dir}/.git/index`);
  // checkout the branch into the working tree
  await git.checkout({dir, ref: branch});

  // delete any files if non-cached requested
  if (!cached) {
    const after = await git.listFiles({dir});
    if (before.length !== after.length) {
      const afterSet = new Set(after);
      return Promise.all(before.filter(f => !afterSet.has(f)).map(f => pfs.unlink(`${dir}/${f}`)));
    }
  }
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

async function writeNewEvents(gatty: Gatty, lastSharedUid: string, uids: string[],
                              events: string[]): Promise<{newEvents: string[]}> {
  await mkdirp(gatty);
  const INIT_POINTER = makePointer(`${EVENTS_DIR}/1`, 0);

  if (lastSharedUid && !(await fileExists(gatty, `${UNIQUES_DIR}/${lastSharedUid}`))) {
    throw new Error('lastSharedUid is in fact not shared ' + lastSharedUid);
  }
  // Write to store the unsync'd events
  let pointer: Pointer = await lastPointer(gatty);
  const endPointer = makePointer(pointer.relativeFile, pointer.chars);
  {
    let i = 0;
    for (const e of events) { pointer = await addEvent(gatty, uids[i++], e, pointer); }
  }
  // get all events that others have pushed that we lack, from lastShareUid to endPointer
  const startPointer = lastSharedUid ? await uniqueToPointer(gatty, lastSharedUid) : INIT_POINTER;
  const rawContents = await pointerToPointer(gatty, startPointer, endPointer);
  const newEvents = rawContents ? rawContents.trim().split('\n') : [];
  return {newEvents: lastSharedUid ? newEvents.slice(1) : newEvents};
}

export async function writer(gatty: Gatty, lastSharedUid: string, uids: string[], events: string[],
                             maxRetries = 3): Promise<{newSharedUid: string, newEvents: string[]}> {
  const {pfs, dir, username, password, token} = gatty;
  const message = `Gatty committing ${uids.length}-long entries on ` + (new Date()).toISOString();
  const name = 'Gatty';
  const email = 'gatty@localhost';
  let newEvents: string[] = [];
  for (let retry = 0; retry < maxRetries; retry++) {
    // pull remote (rewind if failed? or re-run setup with clean slate?)
    try {
      await git.pull({dir, singleBranch: true, fastForwardOnly: true, username, password, token});
    } catch { continue; }
    // edit and git add and get new events
    newEvents = [];
    newEvents = (await writeNewEvents(gatty, lastSharedUid, uids, events)).newEvents;

    const staged = await git.listFiles({dir});
    const statuses = await Promise.all(staged.map(file => git.status({dir, filepath: file})));
    const changes = statuses.some(s => s !== 'unmodified');

    if (!changes) { return {newSharedUid: last(uids) || lastSharedUid, newEvents}; }

    // commit
    await git.commit({dir, message, author: {name, email}});
    // push
    try {
      await git.push({dir, username, password, token});
      return {newSharedUid: last(uids) || lastSharedUid, newEvents};
    } catch (pushed) {
      // if push failed, roll back commit and retry, up to some maximum
      const branch = await git.currentBranch({dir}) || 'master';
      await gitReset({pfs, git, dir, ref: 'HEAD~1', branch, hard: true, cached: false});
    }
  }
  return {newSharedUid: lastSharedUid, newEvents};
}
