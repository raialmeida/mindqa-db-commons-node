import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseTasks } from '../../src/cypress.js';

const mocks = vi.hoisted(() => {
  const select = vi.fn();
  const execute = vi.fn();
  const database = vi.fn(() => ({ select, execute }));
  const connection = vi.fn(() => ({ database, select, execute }));
  const closePools = vi.fn();
  return { select, execute, database, connection, closePools };
});

vi.mock('@mindqa/db-commons', () => ({
  DatabaseService: {
    select: mocks.select,
    execute: mocks.execute,
    database: mocks.database,
    connection: mocks.connection,
    closePools: mocks.closePools,
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('Cypress database tasks', () => {
  it('executes arbitrary SQL with connection and database selection', async () => {
    mocks.select.mockResolvedValue([{ id: 1 }]);
    mocks.execute.mockResolvedValue(2);
    const tasks = createDatabaseTasks();

    await expect(
      tasks['db:select']({
        sql: 'SELECT * FROM clientes WHERE id = ?',
        params: [1],
        connection: 'financeiro',
        database: 'qa',
      }),
    ).resolves.toEqual([{ id: 1 }]);
    await expect(
      tasks['db:execute']({
        sql: 'DELETE FROM clientes WHERE id = ?',
        params: [1],
        connection: 'financeiro',
        database: 'qa',
      }),
    ).resolves.toBe(2);

    expect(mocks.connection).toHaveBeenCalledWith('financeiro');
    expect(mocks.database).toHaveBeenCalledWith('qa');
    expect(mocks.select).toHaveBeenCalledWith(
      'SELECT * FROM clientes WHERE id = ?',
      1,
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      'DELETE FROM clientes WHERE id = ?',
      1,
    );
  });

  it('validates task arguments and returns null after closing pools', async () => {
    mocks.closePools.mockResolvedValue(undefined);
    const tasks = createDatabaseTasks();

    await expect(tasks['db:select'](null as never)).rejects.toThrow(
      'Os argumentos da tarefa de banco devem ser informados em um objeto.',
    );
    await expect(tasks['db:select']({} as never)).rejects.toThrow(
      'O campo sql deve conter um comando SQL.',
    );
    await expect(tasks['db:select']({ sql: '   ' })).rejects.toThrow(
      'O campo sql deve conter um comando SQL.',
    );
    await expect(
      tasks['db:execute']({
        sql: 'DELETE FROM clientes',
        params: 'invalid',
      } as never),
    ).rejects.toThrow('params');
    await expect(
      tasks['db:select']({
        sql: 'SELECT ?',
        params: [new Date()] as never,
      }),
    ).rejects.toThrow('Parâmetro Cypress inválido');
    await expect(
      tasks['db:select']({ sql: 'SELECT ?', params: [1n] as never }),
    ).rejects.toThrow('Parâmetro Cypress inválido');
    await expect(
      tasks['db:select']({
        sql: 'SELECT ?',
        params: [Buffer.from('binary')] as never,
      }),
    ).rejects.toThrow('Parâmetro Cypress inválido');
    await expect(
      tasks['db:select']({
        sql: 'SELECT ?',
        params: [{ id: 1 }] as never,
      }),
    ).rejects.toThrow('Parâmetro Cypress inválido');
    await expect(
      tasks['db:select']({
        sql: 'SELECT ?',
        params: [Number.POSITIVE_INFINITY],
      }),
    ).rejects.toThrow('Parâmetro Cypress inválido');
    await expect(tasks['db:closePools']()).resolves.toBeNull();
    expect(mocks.closePools).toHaveBeenCalledOnce();
  });

  it('serializes the original cause with the selected connection context', async () => {
    const driverError = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const databaseError = new Error('Falha na operação de banco de dados.', {
      cause: driverError,
    });
    databaseError.name = 'DatabaseError';
    mocks.select.mockRejectedValue(databaseError);

    const promise = createDatabaseTasks()['db:select']({
      sql: 'SELECT 1',
      connection: 'financeiro',
      database: 'qa',
    });

    await expect(promise).rejects.toMatchObject({
      name: 'Error',
      cause: databaseError,
      message:
        'Falha na tarefa db:select (conexão: financeiro, base: qa): Error [ECONNREFUSED]: connect ECONNREFUSED',
    });
  });

  it('uses serializable defaults and protects against circular causes', async () => {
    const circular = new Error('pool indisponível');
    Object.defineProperty(circular, 'cause', { value: circular });
    mocks.execute.mockRejectedValue(circular);

    await expect(
      createDatabaseTasks()['db:execute']({ sql: 'DELETE FROM clientes' }),
    ).rejects.toMatchObject({
      name: 'Error',
      message:
        'Falha na tarefa db:execute (conexão: padrão, base: configurada): Error: pool indisponível <- [causa circular]',
    });
  });

  it('includes every AggregateError item when closing pools fails', async () => {
    const aggregate = new AggregateError(
      [new Error('falha PostgreSQL'), new Error('falha Oracle')],
      'Falha ao fechar pools.',
    );
    mocks.closePools.mockRejectedValue(aggregate);

    await expect(
      createDatabaseTasks()['db:closePools'](),
    ).rejects.toMatchObject({
      name: 'Error',
      cause: aggregate,
      message:
        'Falha na tarefa db:closePools: AggregateError: Falha ao fechar pools. <- [Error: falha PostgreSQL; Error: falha Oracle]',
    });
  });
});
