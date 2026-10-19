import { describe, expect, it } from 'vitest';
import {
  bindPlaceholders,
  validateArguments,
} from '../../src/sql/parameters.js';
import type { DatabaseParameter, DatabaseType } from '../../src/types.js';

describe('SQL parameters', () => {
  it('supports CR-only line endings and Unicode PostgreSQL dollar tags', () => {
    expect(
      bindPlaceholders('SELECT $ação$?$ação$ -- ?\r, ?', 1, 'postgresql'),
    ).toBe('SELECT $ação$?$ação$ -- ?\r, $1');
  });

  it('preserves Oracle national alternative quotes with apostrophes', () => {
    expect(
      bindPlaceholders("SELECT nq'[Bob's ?]', ? FROM dual", 1, 'oracle'),
    ).toBe("SELECT nq'[Bob's ?]', :mindqa_p1 FROM dual");
  });
  it.each([
    ['postgresql', '$1', '$2'],
    ['sqlserver', '@mindqa_p1', '@mindqa_p2'],
    ['oracle', ':mindqa_p1', ':mindqa_p2'],
    ['mysql', '?', '?'],
  ] as const)(
    'binds %s without touching literals or comments',
    (type, first, second) => {
      const sql =
        "SELECT '?' AS literal, ? AS value /* ? */ -- ?\n WHERE name = ?";
      expect(bindPlaceholders(sql, 2, type)).toBe(
        `SELECT '?' AS literal, ${first} AS value /* ? */ -- ?\n WHERE name = ${second}`,
      );
    },
  );

  it('handles PostgreSQL dollar quoting, escape strings, nested comments and JSON operators', () => {
    expect(
      bindPlaceholders(
        "SELECT $$?$$, $tag$?$tag$, E'a\\'?b', '?' /* outer /* ? */ ? */ WHERE data ?? ? AND data ??| ?",
        2,
        'postgresql',
      ),
    ).toBe(
      "SELECT $$?$$, $tag$?$tag$, E'a\\'?b', '?' /* outer /* ? */ ? */ WHERE data ? $1 AND data ?| $2",
    );
  });

  it('handles SQL Server brackets and doubled quotes', () => {
    expect(bindPlaceholders("SELECT [a?]]b], 'a''?b', ?", 1, 'sqlserver')).toBe(
      "SELECT [a?]]b], 'a''?b', @mindqa_p1",
    );
  });

  it('handles Oracle q quoting', () => {
    expect(
      bindPlaceholders(
        "SELECT q'[?it''s]', q'{?}', q'!? !', ? FROM dual",
        1,
        'oracle',
      ),
    ).toBe("SELECT q'[?it''s]', q'{?}', q'!? !', :mindqa_p1 FROM dual");
  });

  it('handles MySQL escapes, backticks and hash comments', () => {
    expect(bindPlaceholders("SELECT `a?`, 'a\\'?b', ? # ?\n", 1, 'mysql')).toBe(
      "SELECT `a?`, 'a\\'?b', ? # ?\n",
    );
    expect(() => bindPlaceholders('SELECT 1 /*! + ? */', 0, 'mysql')).toThrow(
      'executáveis',
    );
    expect(bindPlaceholders('SELECT 3--?', 1, 'mysql')).toBe('SELECT 3--?');
  });

  it.each(['postgresql', 'sqlserver', 'mysql', 'oracle'] as DatabaseType[])(
    'rejects counts and unfinished SQL for %s',
    (type) => {
      expect(() => bindPlaceholders('SELECT ?', 0, type)).toThrow(
        '1 placeholders',
      );
      expect(() => bindPlaceholders('SELECT 1', 1, type)).toThrow(
        '0 placeholders',
      );
      expect(() => bindPlaceholders("SELECT 'unterminated ?", 1, type)).toThrow(
        'não terminado',
      );
      expect(() => bindPlaceholders('SELECT /* ?', 1, type)).toThrow(
        'não terminado',
      );
    },
  );

  it('rejects native/reserved placeholders that could collide with generated bindings', () => {
    expect(() => bindPlaceholders('SELECT $1, ?', 1, 'postgresql')).toThrow(
      'somente',
    );
    expect(() =>
      bindPlaceholders('SELECT @mindqa_p1, ?', 1, 'sqlserver'),
    ).toThrow('reservado');
    expect(() => bindPlaceholders('SELECT :mindqa_p1, ?', 1, 'oracle')).toThrow(
      'reservado',
    );
  });

  it('rejects ambiguous or lossy values before I/O', () => {
    for (const value of [
      undefined,
      {},
      [],
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      new Date('invalid'),
    ]) {
      expect(() =>
        validateArguments('SELECT ?', [value as DatabaseParameter]),
      ).toThrow('Parâmetro');
    }
    expect(() => validateArguments(' ', [])).toThrow('vazio');
    expect(() =>
      validateArguments('SELECT ?', [
        null,
        123n,
        new Date(),
        Buffer.from('a'),
        false,
      ]),
    ).not.toThrow();
  });
});
