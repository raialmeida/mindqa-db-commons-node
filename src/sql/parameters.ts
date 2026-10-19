import type { DatabaseParameter, DatabaseType } from '../types.js';

export function validateArguments(
  sql: string,
  params: readonly DatabaseParameter[],
): void {
  if (typeof sql !== 'string' || !sql.trim())
    throw new TypeError('O SQL não pode estar vazio.');
  for (const value of params) {
    const valid =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      (typeof value === 'number' &&
        Number.isFinite(value) &&
        (!Number.isInteger(value) || Number.isSafeInteger(value))) ||
      (value instanceof Date && Number.isFinite(value.getTime())) ||
      Buffer.isBuffer(value);
    if (!valid)
      throw new TypeError(
        'Parâmetro SQL inválido. Use string, número finito seguro, boolean, bigint, Date, Buffer ou null.',
      );
  }
}

/** Scanner por dialeto: valores nunca são interpolados no texto SQL. */
export function bindPlaceholders(
  sql: string,
  count: number,
  type: DatabaseType,
): string {
  let result = '';
  let index = 0;
  let position = 0;
  const placeholder = () => {
    index++;
    if (type === 'postgresql') return `$${index}`;
    if (type === 'sqlserver') return `@mindqa_p${index}`;
    if (type === 'oracle') return `:mindqa_p${index}`;
    return '?';
  };
  while (position < sql.length) {
    const start = position;
    const char = sql[position]!;
    const next = sql[position + 1];
    const lineComment =
      char === '-' &&
      next === '-' &&
      (type !== 'mysql' || (sql[position + 2] ?? ' ').charCodeAt(0) <= 32);
    if (lineComment || (type === 'mysql' && char === '#')) {
      const end = /[\r\n]/.exec(sql.slice(position));
      position = end ? position + end.index + 1 : sql.length;
    } else if (char === '/' && next === '*') {
      if (
        type === 'mysql' &&
        (sql[position + 2] === '!' ||
          sql.slice(position + 2, position + 4) === 'M!')
      ) {
        throw new TypeError(
          'Comentários SQL executáveis do MySQL não são suportados.',
        );
      }
      position += 2;
      let depth = 1;
      while (position < sql.length && depth > 0) {
        const pair = sql.slice(position, position + 2);
        if (pair === '/*' && (type === 'postgresql' || type === 'sqlserver')) {
          depth++;
          position += 2;
        } else if (pair === '*/') {
          depth--;
          position += 2;
        } else position++;
      }
      if (depth) throw new TypeError('Comentário SQL não terminado.');
    } else if (
      type === 'postgresql' &&
      char === '$' &&
      !/[\p{L}\p{N}_$]/u.test(sql[position - 1] ?? '')
    ) {
      const delimiter = /^(?:\$\$|\$[\p{L}_][\p{L}\p{N}_]*\$)/u.exec(
        sql.slice(position),
      )?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, position + delimiter.length);
        if (end < 0)
          throw new TypeError('Texto SQL com dollar quoting não terminado.');
        position = end + delimiter.length;
      } else {
        if (/^\$\d/.test(sql.slice(position)))
          throw new TypeError('Use somente placeholders ? para os parâmetros.');
        position++;
      }
    } else if (
      type === 'oracle' &&
      (/^[qQ]'/.test(sql.slice(position)) ||
        /^[nN][qQ]'/.test(sql.slice(position))) &&
      !/[\w$#]/.test(sql[position - 1] ?? '')
    ) {
      const prefixLength = /[nN]/.test(char) ? 3 : 2;
      const opening = sql[position + prefixLength];
      if (!opening) throw new TypeError('Texto Oracle q-quoted não terminado.');
      const closing =
        ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string, string>)[
          opening
        ] ?? opening;
      const end = sql.indexOf(`${closing}'`, position + prefixLength + 1);
      if (end < 0) throw new TypeError('Texto Oracle q-quoted não terminado.');
      position = end + 2;
    } else if (
      char === "'" ||
      char === '"' ||
      (type === 'mysql' && char === '`') ||
      (type === 'sqlserver' && char === '[')
    ) {
      const closing = char === '[' ? ']' : char;
      const pgEscape =
        type === 'postgresql' &&
        char === "'" &&
        /[eE]/.test(sql[position - 1] ?? '') &&
        !/[\w$]/.test(sql[position - 2] ?? '');
      const backslash = type === 'mysql' || pgEscape;
      position++;
      let closed = false;
      while (position < sql.length) {
        if (backslash && sql[position] === '\\') {
          position += 2;
          continue;
        }
        if (sql[position] === closing) {
          if (sql[position + 1] === closing) {
            position += 2;
            continue;
          }
          position++;
          closed = true;
          break;
        }
        position++;
      }
      if (!closed)
        throw new TypeError('Texto ou identificador SQL não terminado.');
    } else if (char === '?') {
      if (type === 'postgresql' && next === '?') {
        result += '?';
        position += 2;
      } else {
        result += placeholder();
        position++;
      }
      continue;
    } else {
      if (
        (type === 'sqlserver' && /^@mindqa_p\d/i.test(sql.slice(position))) ||
        (type === 'oracle' && /^:mindqa_p\d/i.test(sql.slice(position)))
      ) {
        throw new TypeError(
          'O prefixo mindqa_p é reservado para os parâmetros da biblioteca.',
        );
      }
      position++;
    }
    result += sql.slice(start, position);
  }
  if (index !== count)
    throw new TypeError(
      `O SQL contém ${index} placeholders, mas recebeu ${count} parâmetros.`,
    );
  return result;
}
