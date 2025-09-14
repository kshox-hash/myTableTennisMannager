// src/repositories/BaseRepository.ts
export interface IBaseRepository<T> {
  create(item: T): Promise<T>;
  findById(id: number): Promise<T | null>;
  findAll(): Promise<T[]>;
  update(id: number, item: Partial<T>): Promise<T | null>;
  delete(id: number): Promise<boolean>;
}

export abstract class BaseRepository<T> implements IBaseRepository<T> {
  protected tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  abstract create(item: T): Promise<T>;
  abstract findById(id: number): Promise<T | null>;
  abstract findAll(): Promise<T[]>;
  abstract update(id: number, item: Partial<T>): Promise<T | null>;
  abstract delete(id: number): Promise<boolean>;
}
