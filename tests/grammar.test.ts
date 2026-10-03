import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  linesForArtifacts,
  linesForSite,
  matchCert,
  matchOrg,
  matchProjectMeta,
  matchRole,
  orgRoleDates,
  tenureSpan,
} from '../lib/grammar.ts';

describe('surface markers', () => {
  const lines = ['both', 'web <!--site-only-->', 'paper <!--pdf-only-->'];

  test('artifacts drop site-only lines and strip pdf-only markers', () => {
    assert.deepEqual(linesForArtifacts(lines), ['both', 'paper']);
  });

  test('the site drops pdf-only lines and strips site-only markers', () => {
    assert.deepEqual(linesForSite(lines), ['both', 'web']);
  });
});

describe('line shapes', () => {
  test('org heading', () => {
    assert.deepEqual(matchOrg('### Acme — _Remote_'), { name: 'Acme', location: 'Remote' });
    assert.equal(matchOrg('### A Project'), null);
  });

  test('role in both bold forms', () => {
    assert.deepEqual(matchRole('**Engineer (2020 – 2022)**'), { title: 'Engineer', dates: '2020 – 2022' });
    assert.deepEqual(matchRole('**Engineer** (2020 – Present)'), { title: 'Engineer', dates: '2020 – Present' });
    assert.equal(matchRole('**Engineer**'), null);
  });

  test('certification', () => {
    assert.deepEqual(matchCert('[Sec+](https://x.test/c) — 2024 — CompTIA'), {
      name: 'Sec+',
      url: 'https://x.test/c',
      date: '2024',
      issuer: 'CompTIA',
    });
    assert.equal(matchCert('Plain item'), null);
  });

  test('project meta', () => {
    assert.deepEqual(matchProjectMeta('[Writeup](/writeups/x/) — 2025'), {
      label: 'Writeup',
      href: '/writeups/x/',
      date: '2025',
    });
    assert.equal(matchProjectMeta('- bullet'), null);
  });
});

describe('tenure', () => {
  test('role dates stop at the next heading', () => {
    const lines = [
      '### Acme — _Remote_',
      '**Lead (2023 – Present)**',
      '- did things',
      '**Engineer (2020 – 2023)**',
      '### Other — _Town_',
      '**Intern (2019 – 2019)**',
    ];
    assert.deepEqual(orgRoleDates(lines, 0), ['2023 – Present', '2020 – 2023']);
  });

  test('span runs from the earliest start to the latest end', () => {
    assert.equal(tenureSpan([]), '');
    assert.equal(tenureSpan(['2020 – 2022']), '2020 – 2022');
    assert.equal(tenureSpan(['2023 – Present', '2020 – 2023']), '2020 – Present');
  });
});
