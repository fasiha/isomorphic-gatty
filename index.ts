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

export async function setup({dir, corsProxy, branch, depth, since, username, password, token}: Partial<Gatty> = {},
                            url: string): Promise<Gatty> {
  dir = dir || DEFAULT_DIR;
  corsProxy = corsProxy || DEFAULT_PROXY;

  const fs = new LightningFS('fs', {wipe: true});
  const pfs = fs.promises;
  git.plugins.set('fs', fs);

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
export async function atomicAppend({pfs, dir, username, password, token}: Gatty, filepath: string, content: string,
                                   message: string, name: string, email: string, maxRetries = 3) {
  // pull remote (rewind if failed?)
  // write/append
  // commit
  // push
  // if push failed, roll back commit and retry, up to some maximum
  for (let retry = 0; retry < maxRetries; retry++) {
    await git.pull({dir, singleBranch: true, fastForwardOnly: true, username, password, token});
    console.log('pulled latest');

    const fullpath = `${dir}/${filepath}`;
    let oldContents = '';
    try {
      oldContents = await pfs.readFile(fullpath, 'utf8');
    } catch (e) {
      // `readFile` will throw if file not found. Moving along.
    }
    await pfs.writeFile(fullpath, oldContents + content, 'utf8');
    console.log('wrote file');

    await git.add({dir, filepath});
    console.log('added file');

    await git.commit({dir, message, author: {name, email}});
    console.log('committed');

    const pushed: PushResult = await git.push({dir, username, password, token});
    console.log('pushed');

    if (pushed.errors) {
      console.log('push encountered error');

      const branch = await git.currentBranch({dir});
      await gitReset({pfs, git, dir, ref: 'HEAD~1', branch, hard: true});
      console.log('git-reset');
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
