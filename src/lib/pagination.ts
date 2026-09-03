export const getPageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize));

export const paginateArray = <T>(items: T[], page: number, pageSize: number): T[] =>
  items.slice((page - 1) * pageSize, page * pageSize);