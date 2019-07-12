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
};

export async function setup({dir, corsProxy, branch, depth, since, username, password, token}: Partial<Gatty> = {},
                            url: string, fs?: any): Promise<Gatty> {
  dir = dir || DEFAULT_DIR;
  corsProxy = corsProxy || DEFAULT_PROXY;

  if (!fs) {
    const fs = new LightningFS('fs', {wipe: true});
    git.plugins.set('fs', fs);
  }
  const pfs = fs.promises;

  await pfs.mkdir(dir);
  await git.clone({url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token});
  return {dir, corsProxy, pfs, branch, depth, since, username, password, token};
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
    return pfs.stat(fullpath).then((res: Stats) => !res.isDirectory());
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
  return makePointer(lastFile.slice(dir.length + 1), filecontents.length);
}

type AddEventOptions = {
  maxchars: number,
  pointer: Partial<Pointer>
};
async function addEvent(gatty: Gatty, uid: string, payload: string,
                        {maxchars = 1024, pointer = {}}: Partial<AddEventOptions> = {}): Promise<Pointer> {
  if (!('relativeFile' in pointer && 'chars' in pointer && pointer.relativeFile)) {
    const {relativeFile, chars} = await lastPointer(gatty);
    pointer.relativeFile = relativeFile || `${EVENTS_DIR}/1`;
    pointer.chars = chars;
  }
  const {relativeFile, chars} = pointer as Pointer;

  const uniqueFile = `${UNIQUES_DIR}/${uid}`;
  if (await fileExists(gatty, uniqueFile)) { return makePointer(relativeFile, chars); }

  if (chars < maxchars) {
    const ret = appendFile(gatty, relativeFile, payload);
    appendFile(gatty, uniqueFile, `${relativeFile}${POINTER_SEP}${chars.toString(BASE)}`);
    return ret;
  }

  const lastFilename = last(relativeFile.split('/')) || '1';
  const parsed = parseInt(lastFilename, BASE);
  if (isNaN(parsed)) { throw new Error('non-numeric filename'); }
  const newFile = (parsed + 1).toString(BASE);
  const ret = appendFile(gatty, newFile, payload);
  appendFile(gatty, uniqueFile, `${relativeFile}-${chars.toString(BASE)}`);
  return ret;
}

async function uniqueToPayload(gatty: Gatty, unique: string): Promise<string> {
  const pointerStr = await readFile(gatty, `${UNIQUES_DIR}/${unique}`);
  const [file, offset] = pointerStr.split(POINTER_SEP);
  if (!file || !offset) { throw new Error('failed to parse unique ' + unique); }
  let contents = await readFile(gatty, `${EVENTS_DIR}/${file}`);
  const offsetBytes = parseInt(offset, BASE);
  contents.slice(offsetBytes)
  const end = contents.indexOf('\n');
  if (end < 0) { return contents; }
  return contents.slice(0, end);
}

async function uniqueToPointer(gatty: Gatty, unique: string): Promise<Pointer> {
  if (!unique) { return makePointer('', 0) }
  const pointerStr = await readFile(gatty, `${UNIQUES_DIR}/${unique}`);
  const [file, offset] = pointerStr.split(POINTER_SEP);
  if (!file || !offset) { throw new Error('failed to parse unique ' + unique); }
  return makePointer(file, parseInt(offset, BASE));
}

async function pointerToPointer(gatty: Gatty, start: Pointer, end: Pointer): Promise<string> {
  if (!start.relativeFile || !end.relativeFile) { return ''; }
  const fileInts = [start, end].map(({relativeFile}) => parseInt(relativeFile.slice(EVENTS_DIR.length), BASE));
  let contents = (await readFile(gatty, start.relativeFile)).slice(start.chars);
  for (let i = fileInts[0] + 1; i < fileInts[1]; i++) { contents += await readFile(gatty, i.toString(BASE)); }
  if (start.relativeFile !== end.relativeFile) {
    contents += (await readFile(gatty, end.relativeFile)).slice(0, end.chars);
  }
  return contents;
}

export async function sync(gatty: Gatty, lastSharedUid: string, uids: string[], events: string[]): Promise<string[]> {
  const {pfs, dir} = gatty;
  try {
    await pfs.mkdir(dir);
  } catch {}
  try {
    await pfs.mkdir(`${dir}/${EVENTS_DIR}`);
  } catch {}
  try {
    await pfs.mkdir(`${dir}/${UNIQUES_DIR}`);
  } catch {}

  if (lastSharedUid && !(await fileExists(gatty, `${UNIQUES_DIR}/${lastSharedUid}`))) {
    throw new Error('lastSharedUid is in fact not shared ' + lastSharedUid);
  }
  // Write to store the unsync'd events
  let pointer: Pointer = await lastPointer(gatty);
  const endPointer = makePointer(pointer.relativeFile, pointer.chars);
  {
    let i = 0;
    for (const e of events) { pointer = await addEvent(gatty, uids[i++], e, {pointer}); }
  }
  // get all events that others have pushed that we lack, from lastShareUid to endPointer
  const startPointer = await uniqueToPointer(gatty, lastSharedUid);
  const rawContents = await pointerToPointer(gatty, startPointer, endPointer);
  return rawContents.split('\n');
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
      token: ''
    };
    let events = 'hello!,hi there!,how are you?'.split(',');
    function slug(s: string) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '') }
    let uids = events.map(slug);
    await sync(gatty, '', uids, events);

    console.log('syncd')

    let newEvents = 'chillin,cruisin,flying'.split(',');
    let newUids = newEvents.map(slug);
    await sync(gatty, uids[uids.length - 1], newUids, newEvents);

    console.log('done');
  })();
}
