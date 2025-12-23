// src/repositories/BaseRepository.ts
export interface IBaseRepository<T> {
  create(item: T): Promise<T>;
  findByEmail(email: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  updateByEmail(email: string, item: Partial<T>): Promise<T | null>;
  deleteByEmail(email: string): Promise<boolean>;
}

export abstract class BaseRepository<T> implements IBaseRepository<T> {
  protected tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  abstract create(item: T): Promise<T>;
  abstract findByEmail(email: string): Promise<T | null>;
  abstract findAll(): Promise<T[]>;
  abstract updateByEmail(email: string, item: Partial<T>): Promise<T | null>;
  abstract deleteByEmail(email: string): Promise<boolean>;
}
