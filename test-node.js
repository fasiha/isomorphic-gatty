"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const tape_1 = __importDefault(require("tape"));
const index_1 = require("./index");
const git = require('isomorphic-git');
const fs = require('fs');
const rimraf = require('rimraf');
git.plugins.set('fs', fs);
function slug(s) { return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, ''); }
const events = 'hello!,hi there!,how are you?'.split(',').map(s => s + '\n');
const uids = events.map(slug);
const DIR = 'whee';
tape_1.default('intro', (t) => __awaiter(this, void 0, void 0, function* () {
    // delete old git dir
    rimraf.sync(DIR);
    const gatty = {
        pfs: fs_1.promises,
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
    const { newEvents, filesTouched } = yield index_1.writeNewEvents(gatty, '', uids, events);
    t.deepEqual(newEvents, []);
    t.deepEqual(Array.from(filesTouched).sort(), ['_events/1']);
    t.deepEqual(yield fs_1.promises.readdir(`${DIR}/_events/`), ['1']);
    t.deepEqual((yield fs_1.promises.readdir(`${DIR}/_uniques/`)).sort(), ['hello', 'hi-there', 'how-are-you'].sort());
    rimraf.sync(DIR);
    t.end();
}));
//# sourceMappingURL=test-node.js.map