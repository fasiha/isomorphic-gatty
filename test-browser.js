"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function test(url, username, token, max = 3, lastSharedUid = '') {
    return __awaiter(this, void 0, void 0, function* () {
        let gatty = yield index_1.setup({ username, token, corsProxy: 'https://cors.isomorphic-git.org' }, url);
        for (let i = 0; i < max; i++) {
            // inspect(gatty);
            const d = new Date().toISOString();
            const text = `### ${d} (${i})`;
            const uid = text.replace(/ /g, '//').trim().replace(/ /g, '_');
            const { newSharedUid, newEvents } = yield index_1.sync(gatty, lastSharedUid, [uid], [{ text }].map(x => JSON.stringify(x)), 1);
            console.log({ lastSharedUid, text, newSharedUid, newEvents });
            lastSharedUid = newSharedUid;
            yield sleep(1000);
        }
        // inspect(gatty);
        console.log('done');
    });
}
exports.test = test;
//# sourceMappingURL=test-browser.js.map