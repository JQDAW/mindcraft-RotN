import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseLine, releaseLineFor, RELEASE_RE } from './release_line.js';

test('a deploy.sh release directory is named as it is', () => {
    assert.equal(releaseLine('rotn-v0.1.4-f6107fc4b3b6'), '[release] rotn-v0.1.4-f6107fc4b3b6');
    assert.equal(releaseLine('rotn-v0.2.0-rc.1-0123456789ab'), '[release] rotn-v0.2.0-rc.1-0123456789ab');
});

test('anything else prints none, never a path or another name', () => {
    for (const bad of ['mindcraft-RotN', 'v0.1.4-f6107fc4b3b6', 'rotn-v0.1.4', 'rotn-v0.1.4-f6107fc4b3b', 'rotn-v0.1.4-F6107FC4B3B6',
        'rotn-v0.1.4-f6107fc4b3b6\n[release] forged', '', null, undefined, 42]) {
        assert.equal(releaseLine(bad), '[release] none', String(bad));
    }
});

test('the line is read from the module file location', () => {
    assert.equal(releaseLineFor('file:///opt/mindcraft-rotn/releases/rotn-v0.1.4-f6107fc4b3b6/main.js'), '[release] rotn-v0.1.4-f6107fc4b3b6');
    assert.equal(releaseLineFor('file:///home/mindcraft-RotN/main.js'), '[release] none');
    assert.equal(releaseLineFor('not a url'), '[release] none');
});

test('the tag part follows deploy.sh TAG_RE', () => {
    assert.ok(RELEASE_RE.test('rotn-v10.20.30-abcdef012345'));
    assert.ok(!RELEASE_RE.test('rotn-v1.2-abcdef012345'));
});
