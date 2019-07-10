import pify from 'pify';
const LightningFS = require('@isomorphic-git/lightning-fs');
const git = require('isomorphic-git');

const DEFAULT_DIR = '/gitdir';
const DEFAULT_PROXY = 'https://cors.isomorphic-git.org';

export type Gatty = {
  pfs: any,
  dir: string,
  corsProxy: string,
  branch: string|undefined,
  depth: number|undefined,
  since: Date|undefined,
  username: string|undefined,
  password: string|undefined,
  token: string|undefined,
};

export async function setup(url: string, {dir, corsProxy, branch, depth, since, username, password, token}:
                                             Partial<Gatty> = {}): Promise<Gatty> {
  dir = dir || DEFAULT_DIR;
  corsProxy = corsProxy || DEFAULT_PROXY;

  const fs = new LightningFS('fs', {wipe: true});
  const pfs = pify(fs);
  git.plugins.set('fs', fs);

  await pfs.mkdir(dir);
  await git.clone({url, dir, corsProxy, ref: branch, singleBranch: true, depth, since, username, password, token});
  return {dir, corsProxy, pfs, branch, depth, since, username, password, token};
}

export async function push({dir, username, password, token}: Gatty) {
  let pushres = await git.push({dir, username, password, token});
  return pushres.errors;
}

export async function ls(filepath: string = '', {dir, pfs}: Gatty): Promise<string[]> {
  return pfs.readdir(filepath ? `${dir}/${filepath}`.replace(/\/+$/, '') : dir);
}

export async function readFile(filepath: string, {dir, pfs}: Gatty): Promise<string> {
  return pfs.readFile(`${dir}/${filepath}`, 'utf8');
}

export async function writeFileCommit(filepath: string, contents: string, message: string, name: string = 'Me',
                                      email: string = 'mrtest@example.com', {pfs, dir}: Gatty): Promise<string> {
  await pfs.writeFile(`${dir}/${filepath}`, contents, 'utf8');
  await git.add({dir, filepath});
  return git.commit({dir, message, author: {name, email}});
}

export async function atomicAppend(filepath: string, content: string, maxRetries = 3, {pfs, dir}: Gatty) {
  // pull to remote
  // write/append
  // commit
  // push
  // if push failed, roll back commit and retry, up to some maximum
}